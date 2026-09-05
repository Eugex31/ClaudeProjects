import { NextResponse } from "next/server";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";

// MRR counts ACTIVE and PAST_DUE (still-expected revenue, Stripe's dunning
// hasn't given up yet) — not TRIALING (no revenue yet) or CANCELED.
const MRR_STATUSES: SubscriptionStatus[] = ["ACTIVE", "PAST_DUE"];

export const GET = withAdminAuth(async () => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [billableSubscriptions, canceledThisMonth, plans] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: { in: MRR_STATUSES } },
      select: { planId: true, plan: { select: { key: true, name: true, monthlyPriceCents: true } } },
    }),
    prisma.subscription.count({
      where: { status: "CANCELED", canceledAt: { gte: monthStart } },
    }),
    prisma.plan.findMany({ orderBy: { monthlyPriceCents: "asc" }, select: { key: true, name: true } }),
  ]);

  const mrrCents = billableSubscriptions.reduce((sum, s) => sum + s.plan.monthlyPriceCents, 0);

  const byTier = new Map(plans.map((p) => [p.key, { key: p.key, name: p.name, activeCount: 0 }]));
  for (const s of billableSubscriptions) {
    const entry = byTier.get(s.plan.key);
    if (entry) entry.activeCount += 1;
  }

  return NextResponse.json({
    mrrCents,
    activeSubscriptions: billableSubscriptions.length,
    canceledThisMonth,
    byTier: Array.from(byTier.values()),
  });
});
