import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { stripe } from "@/lib/stripe";

const MONTHS_OF_HISTORY = 12;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastNMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

export const GET = withAdminAuth(async () => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const historyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_OF_HISTORY - 1), 1));

  const [totalCustomers, activeCustomers, users, canceledThisMonth, currentlyActiveSubscriptions] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    // Bucketed by month in JS — same "small dataset, aggregate in memory"
    // choice already made for Phase 4.6's reporting rather than raw SQL
    // date_trunc, since this app has no other precedent for that.
    prisma.user.findMany({ where: { createdAt: { gte: historyStart } }, select: { createdAt: true } }),
    prisma.subscription.count({ where: { status: "CANCELED", canceledAt: { gte: monthStart } } }),
    // Subscription has no createdAt of its own (only updatedAt), so there's
    // no precise "active as of the start of the month" snapshot available —
    // using the current active count as the denominator is the standard
    // simplification, not a precise cohort calculation.
    prisma.subscription.count({ where: { status: { in: ["ACTIVE", "PAST_DUE"] } } }),
  ]);

  const monthKeys = lastNMonthKeys(MONTHS_OF_HISTORY);
  const signupsByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const u of users) {
    const key = monthKey(u.createdAt);
    if (signupsByMonth.has(key)) signupsByMonth.set(key, signupsByMonth.get(key)! + 1);
  }

  // Revenue history pulled from Stripe's own paid invoices (the real record
  // of what was actually collected) rather than a new snapshot table this
  // app would have to populate on a schedule — matches the existing
  // "Stripe stays the source of truth" pattern used for customer invoices.
  const revenueByMonth = new Map(monthKeys.map((k) => [k, 0]));
  if (stripe) {
    let startingAfter: string | undefined;
    for (;;) {
      const page = await stripe.invoices.list({
        status: "paid",
        created: { gte: Math.floor(historyStart.getTime() / 1000) },
        limit: 100,
        starting_after: startingAfter,
      });
      for (const inv of page.data) {
        const key = monthKey(new Date(inv.created * 1000));
        if (revenueByMonth.has(key)) {
          revenueByMonth.set(key, revenueByMonth.get(key)! + inv.amount_paid);
        }
      }
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1]?.id;
      if (!startingAfter) break;
    }
  }

  // Churn = canceled this month / currently active subscriptions — 0 rather
  // than a divide-by-zero when nobody had a subscription yet.
  const churnRate =
    currentlyActiveSubscriptions > 0 ? Math.round((canceledThisMonth / currentlyActiveSubscriptions) * 1000) / 10 : 0;

  return NextResponse.json({
    totalCustomers,
    activeCustomers,
    suspendedCustomers: totalCustomers - activeCustomers,
    signupsByMonth: monthKeys.map((key) => ({ month: key, count: signupsByMonth.get(key) ?? 0 })),
    revenueByMonth: monthKeys.map((key) => ({ month: key, amountCents: revenueByMonth.get(key) ?? 0 })),
    churnRate,
    canceledThisMonth,
  });
});
