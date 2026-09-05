import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { stripe } from "@/lib/stripe";

// Distinct from suspend/reactivate — this affects billing/plan status, not
// login access. Immediate cancellation (not "at period end"): an admin
// clicking Cancel is a deliberate override, not a self-serve courtesy.
export const POST = withAdminAuth<{ id: string }>(async (_req, { params, adminEmail }) => {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true, name: true } }),
    prisma.subscription.findUnique({ where: { userId: params.id }, select: { stripeSubscriptionId: true, planId: true } }),
  ]);
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  if (subscription?.stripeSubscriptionId && stripe) {
    // Let the webhook (customer.subscription.deleted -> syncSubscriptionFromStripe)
    // sync the local row, same path a self-serve cancellation takes — no
    // separate local update here to avoid the two ever disagreeing.
    await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
  } else if (subscription) {
    // No live Stripe subscription (comped or never checked out) — nothing
    // for a webhook to sync later, so mark it directly.
    await prisma.subscription.update({
      where: { userId: params.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
  } else {
    return NextResponse.json({ error: "This customer has no subscription to cancel" }, { status: 400 });
  }

  await logAdminAction({
    adminEmail,
    targetUserId: user.id,
    targetEmail: user.email,
    targetName: user.name,
    action: "CANCEL_SUBSCRIPTION",
  });

  return NextResponse.json({ ok: true });
});
