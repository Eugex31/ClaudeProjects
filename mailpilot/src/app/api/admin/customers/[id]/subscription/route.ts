import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { assignPlanSchema } from "@/lib/validation/admin.schema";
import { stripe } from "@/lib/stripe";

// Two cases, handled differently on purpose — see the plan's reasoning:
// a customer with no live Stripe subscription is safely comped by editing
// our row directly (nothing in Stripe will ever fire an event to clobber
// it); a customer who's actually paying via Stripe gets their real Stripe
// subscription's price changed instead, and the existing webhook
// (customer.subscription.updated -> syncSubscriptionFromStripe) syncs our
// row afterward — Stripe stays the one source of truth for anyone actually
// being billed.
export const PUT = withAdminAuth<{ id: string }>(async (req, { params, adminEmail }) => {
  const [user, existingSubscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true, name: true } }),
    prisma.subscription.findUnique({
      where: { userId: params.id },
      select: { stripeSubscriptionId: true, plan: { select: { name: true } } },
    }),
  ]);
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const { planKey, trialEndsAt } = assignPlanSchema.parse(await req.json());
  const targetPlan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!targetPlan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const oldPlanName = existingSubscription?.plan.name ?? "Free";

  if (existingSubscription?.stripeSubscriptionId && targetPlan.stripePriceId && stripe) {
    const stripeSubscription = await stripe.subscriptions.retrieve(existingSubscription.stripeSubscriptionId);
    const itemId = stripeSubscription.items.data[0]?.id;
    if (!itemId) {
      return NextResponse.json({ error: "Could not find the Stripe subscription item to update" }, { status: 502 });
    }
    // proration_behavior: "none" — an admin override shouldn't generate a
    // surprise prorated line item on the customer's next invoice.
    await stripe.subscriptions.update(existingSubscription.stripeSubscriptionId, {
      items: [{ id: itemId, price: targetPlan.stripePriceId }],
      proration_behavior: "none",
    });
    // No local write here — the webhook this triggers syncs Subscription
    // via syncSubscriptionFromStripe, same as any self-serve plan change.
  } else {
    await prisma.subscription.upsert({
      where: { userId: params.id },
      create: {
        userId: params.id,
        planId: targetPlan.id,
        status: trialEndsAt ? "TRIALING" : "ACTIVE",
        currentPeriodEnd: trialEndsAt ?? null,
      },
      update: {
        planId: targetPlan.id,
        status: trialEndsAt ? "TRIALING" : "ACTIVE",
        currentPeriodEnd: trialEndsAt ?? null,
        canceledAt: null,
      },
    });
  }

  await logAdminAction({
    adminEmail,
    targetUserId: user.id,
    targetEmail: user.email,
    targetName: user.name,
    action: "ASSIGN_PLAN",
    details: `${oldPlanName} -> ${targetPlan.name}${trialEndsAt ? ` (trial until ${trialEndsAt.toISOString()})` : ""}`,
  });

  return NextResponse.json({ ok: true });
});
