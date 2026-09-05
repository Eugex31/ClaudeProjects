import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { getEffectiveSubscription, getUsage } from "@/lib/billing";

export const GET = withAuth(async (_req, { userId }) => {
  const subscription = await getEffectiveSubscription(userId);
  const [usage, plans] = await Promise.all([
    getUsage(userId, subscription),
    prisma.plan.findMany({ orderBy: { monthlyPriceCents: "asc" } }),
  ]);

  return NextResponse.json({
    subscription: {
      planKey: subscription.plan.key,
      planName: subscription.plan.name,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      hasStripeCustomer: !!subscription.stripeCustomerId,
    },
    usage,
    limits: {
      contactLimit: subscription.plan.contactLimit,
      emailsPerMonthLimit: subscription.plan.emailsPerMonthLimit,
    },
    plans,
  });
});
