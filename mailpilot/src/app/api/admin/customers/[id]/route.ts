import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { getEffectiveSubscription } from "@/lib/billing";
import { logAdminAction } from "@/lib/adminAudit";
import { deleteCustomerSchema } from "@/lib/validation/admin.schema";

export const GET = withAdminAuth<{ id: string }>(async (_req, { params }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, status: true, createdAt: true, lastLoginAt: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const [subscription, contactCount, campaignsSentCount, hasGoogleAccount] = await Promise.all([
    getEffectiveSubscription(user.id),
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.campaignRecipient.count({ where: { status: "SENT", campaign: { userId: user.id } } }),
    prisma.account.findFirst({ where: { userId: user.id, provider: "google" }, select: { id: true } }),
  ]);

  return NextResponse.json({
    customer: {
      ...user,
      hasGoogleAccount: !!hasGoogleAccount,
      planName: subscription.plan.name,
      billingStatus: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      contactCount,
      campaignsSentCount,
    },
  });
});

export const DELETE = withAdminAuth<{ id: string }>(async (req, { params, adminEmail }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Require the exact email as confirmation, checked server-side too — not
  // just a client-side gate, since this is irreversible.
  const { confirmEmail } = deleteCustomerSchema.parse(await req.json());
  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "Confirmation email does not match" }, { status: 400 });
  }

  // Log before deleting — targetUserId in the log has no FK, so it survives
  // the cascade that's about to remove the User row itself.
  await logAdminAction({
    adminEmail,
    targetUserId: user.id,
    targetEmail: user.email,
    targetName: user.name,
    action: "DELETE",
  });

  // Every relation to User cascades (onDelete: Cascade) — contacts, campaigns,
  // settings, and subscription all go with it.
  await prisma.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
