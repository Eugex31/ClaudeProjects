import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

// Access control only — does not touch Stripe/billing. A suspended customer
// keeps being billed unless their subscription is separately canceled. Also
// halts in-flight worker sends, not just future login — see the
// `AND u.status = 'ACTIVE'` join added to src/worker/poller.ts.
export const POST = withAdminAuth<{ id: string }>(async (_req, { params, adminEmail }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: params.id }, data: { status: "SUSPENDED" } }),
    prisma.session.deleteMany({ where: { userId: params.id } }),
  ]);
  await logAdminAction({
    adminEmail,
    targetUserId: user.id,
    targetEmail: user.email,
    targetName: user.name,
    action: "SUSPEND",
  });

  return NextResponse.json({ ok: true });
});
