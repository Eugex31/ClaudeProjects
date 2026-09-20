import { prisma } from "@/lib/prisma";
import type { Plan, SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";

export type EffectiveSubscription = {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string | null;
  cancelAtPeriodEnd: boolean;
};

// Mirrors getEffectiveSettings() in src/lib/settings.ts: return the real row
// if one exists, otherwise a virtual default — a Free-tier customer never
// gets a Subscription row until they actually check out (see
// src/app/api/webhooks/stripe/route.ts). A CANCELED subscription also falls
// back to Free, but keeps stripeCustomerId around so re-subscribing reuses
// the existing Stripe customer instead of creating a duplicate.
export async function getEffectiveSubscription(userId: string): Promise<EffectiveSubscription> {
  const subscription = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });

  if (subscription && subscription.status !== "CANCELED") {
    return {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      stripeCustomerId: subscription.stripeCustomerId,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }

  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { key: "free" } });
  return {
    plan: freePlan,
    status: "ACTIVE",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    stripeCustomerId: subscription?.stripeCustomerId ?? null,
    cancelAtPeriodEnd: false,
  };
}

function toUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfCalendarMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type Usage = { contacts: number; emailsThisPeriod: number; aiGenerationsThisPeriod: number; socialAccounts: number };

// The "period" is the customer's actual Stripe billing cycle when they have
// one, else calendar-month-to-date for Free (which has no billing cycle to
// anchor to). emailsThisPeriod counts both what's already sent (SendCounter)
// and what's currently queued (PENDING/RETRYING/SENDING recipients across
// every campaign) — a second campaign started before the first finishes has
// to account for the first's queued sends too, or two campaigns together
// could clear the monthly cap while each looked fine individually.
// socialAccounts is a standing count (connections right now), not a
// period-bounded metric like the other three — there's no "per month" for
// how many accounts are connected.
export async function getUsage(userId: string, subscription?: EffectiveSubscription): Promise<Usage> {
  const sub = subscription ?? (await getEffectiveSubscription(userId));
  const periodStart = toUtcDate(sub.currentPeriodStart ?? startOfCalendarMonthUtc());
  const periodEnd = toUtcDate(sub.currentPeriodEnd ?? new Date());

  const [contacts, sendCounters, queuedRecipients, aiUsageCounters, socialAccounts] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.sendCounter.aggregate({
      where: { userId, date: { gte: periodStart, lte: periodEnd } },
      _sum: { sentCount: true },
    }),
    prisma.campaignRecipient.count({
      where: { status: { in: ["PENDING", "RETRYING", "SENDING"] }, campaign: { userId } },
    }),
    prisma.aiUsageCounter.aggregate({
      where: { userId, date: { gte: periodStart, lte: periodEnd } },
      _sum: { count: true },
    }),
    prisma.socialAccount.count({ where: { userId } }),
  ]);

  return {
    contacts,
    emailsThisPeriod: (sendCounters._sum.sentCount ?? 0) + queuedRecipients,
    aiGenerationsThisPeriod: aiUsageCounters._sum.count ?? 0,
    socialAccounts,
  };
}

export type TierLimitCheck =
  | { allowed: true }
  | { allowed: false; limit: number; used: number; message: string };

// additional = how many more contacts/emails this specific action would add.
export async function checkTierLimit(
  userId: string,
  kind: "contacts" | "emails",
  additional: number
): Promise<TierLimitCheck> {
  const subscription = await getEffectiveSubscription(userId);
  const usage = await getUsage(userId, subscription);

  const limit = kind === "contacts" ? subscription.plan.contactLimit : subscription.plan.emailsPerMonthLimit;
  const used = kind === "contacts" ? usage.contacts : usage.emailsThisPeriod;

  if (used + additional <= limit) {
    return { allowed: true };
  }

  const remaining = Math.max(0, limit - used);
  const noun = kind === "contacts" ? "contacts" : "emails this billing period";
  return {
    allowed: false,
    limit,
    used,
    message: `Your ${subscription.plan.name} plan allows ${limit.toLocaleString()} ${noun}. You have ${remaining.toLocaleString()} remaining — upgrade to continue.`,
  };
}

// Checked when a sequence transitions to ACTIVE (src/app/api/sequences/[id]/activate/route.ts),
// not at creation — a DRAFT sequence shouldn't count against the limit.
// -1 on Plan.activeSequenceLimit means unlimited (Pro/Agency).
export async function checkSequenceLimit(userId: string): Promise<TierLimitCheck> {
  const subscription = await getEffectiveSubscription(userId);
  const limit = subscription.plan.activeSequenceLimit;
  if (limit === -1) {
    return { allowed: true };
  }

  const used = await prisma.sequence.count({ where: { userId, status: "ACTIVE" } });
  if (used < limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    limit,
    used,
    message: `Your ${subscription.plan.name} plan allows ${limit} active sequence${limit === 1 ? "" : "s"}. Pause another one or upgrade to activate more.`,
  };
}

// Checked before connecting Monday.com and before re-enabling sync
// (src/app/api/integrations/monday/**) — a boolean feature flag, not a
// numeric limit, so it's its own small check rather than reusing
// checkTierLimit's used/remaining shape.
export async function requireCrmEnabled(userId: string): Promise<TierLimitCheck> {
  const subscription = await getEffectiveSubscription(userId);
  if (subscription.plan.crmEnabled) {
    return { allowed: true };
  }
  return {
    allowed: false,
    limit: 0,
    used: 0,
    message: `Your ${subscription.plan.name} plan doesn't include CRM sync — upgrade to Pro or Agency to connect Monday.com.`,
  };
}

// Same shape as checkSequenceLimit — a flat row-count against the plan's
// limit, not a usage-within-a-billing-period check like contacts/emails,
// since templates have no status field to filter on. Checked on every path
// that creates a new saved Template row (create, duplicate, and "Edit" on a
// starter template) — never on "Use," which fills a form and creates nothing.
export async function checkTemplateLimit(userId: string): Promise<TierLimitCheck> {
  const subscription = await getEffectiveSubscription(userId);
  const limit = subscription.plan.templateLimit;
  if (limit === -1) {
    return { allowed: true };
  }

  const used = await prisma.template.count({ where: { userId } });
  if (used < limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    limit,
    used,
    message: `Your ${subscription.plan.name} plan allows ${limit} saved template${limit === 1 ? "" : "s"}. Delete one or upgrade to save more.`,
  };
}

// Checked before every AI generation call (src/lib/ai/generate.ts's callers).
// Sums AiUsageCounter over the same billing-period window getUsage() uses
// for emails — Stripe's real cycle when one exists, else calendar-month.
// -1 on Plan.aiGenerationsPerMonthLimit means unlimited.
export async function checkAiUsageLimit(userId: string): Promise<TierLimitCheck> {
  const subscription = await getEffectiveSubscription(userId);
  const limit = subscription.plan.aiGenerationsPerMonthLimit;
  if (limit === -1) {
    return { allowed: true };
  }

  const periodStart = toUtcDate(subscription.currentPeriodStart ?? startOfCalendarMonthUtc());
  const periodEnd = toUtcDate(subscription.currentPeriodEnd ?? new Date());
  const result = await prisma.aiUsageCounter.aggregate({
    where: { userId, date: { gte: periodStart, lte: periodEnd } },
    _sum: { count: true },
  });
  const used = result._sum.count ?? 0;

  if (used < limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    limit,
    used,
    message: `Your ${subscription.plan.name} plan allows ${limit.toLocaleString()} AI generations this billing period. Upgrade for more.`,
  };
}

// Same shape as checkSequenceLimit/checkTemplateLimit — a flat row-count
// against the plan's limit. Checked in POST /api/social/meta/pages/activate
// (for the net-new accounts being added), never at Facebook-login time,
// since logging in with Facebook creates no SocialAccount rows by itself.
export async function checkSocialAccountLimit(userId: string, additional: number): Promise<TierLimitCheck> {
  const subscription = await getEffectiveSubscription(userId);
  const limit = subscription.plan.socialAccountLimit;
  if (limit === -1) {
    return { allowed: true };
  }

  const used = await prisma.socialAccount.count({ where: { userId } });
  if (used + additional <= limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    limit,
    used,
    message: `Your ${subscription.plan.name} plan allows ${limit} connected social account${limit === 1 ? "" : "s"}. Disconnect one or upgrade to connect more.`,
  };
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    default:
      // canceled, incomplete, incomplete_expired, unpaid, paused
      return "CANCELED";
  }
}

async function resolveUserIdFromStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const row = await prisma.subscription.findFirst({
    where: { stripeCustomerId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

// Upserts our Subscription row from a live Stripe Subscription object — used
// by every webhook handler in src/app/api/webhooks/stripe/route.ts so
// customer.subscription.updated (including Portal-driven plan switches) and
// checkout.session.completed both funnel through the same logic. `userId` is
// required the first time (from checkout's client_reference_id, since no
// local row exists yet to look the customer up by); later events resolve it
// from the already-created row.
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription,
  userId?: string
): Promise<void> {
  const priceId = stripeSubscription.items.data[0]?.price.id;
  const plan = priceId ? await prisma.plan.findFirst({ where: { stripePriceId: priceId } }) : null;
  if (!plan) {
    console.warn(`[billing] Stripe subscription ${stripeSubscription.id} has no matching local Plan for price ${priceId}`);
    return;
  }

  const resolvedUserId = userId ?? (await resolveUserIdFromStripeCustomer(stripeSubscription.customer as string));
  if (!resolvedUserId) {
    console.warn(`[billing] Could not resolve a userId for Stripe customer ${stripeSubscription.customer}`);
    return;
  }

  const data = {
    planId: plan.id,
    stripeCustomerId: stripeSubscription.customer as string,
    stripeSubscriptionId: stripeSubscription.id,
    status: mapStripeStatus(stripeSubscription.status),
    currentPeriodStart: new Date(stripeSubscription.items.data[0].current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSubscription.items.data[0].current_period_end * 1000),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    canceledAt: stripeSubscription.status === "canceled" ? new Date() : null,
  };

  await prisma.subscription.upsert({
    where: { userId: resolvedUserId },
    create: { userId: resolvedUserId, ...data },
    update: data,
  });
}
