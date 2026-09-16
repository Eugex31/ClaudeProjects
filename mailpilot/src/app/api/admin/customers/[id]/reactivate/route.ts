import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";

export const POST = withAdminAuth<{ id: string }>(async (_req, { params, adminEmail }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  await prisma.user.update({ where: { id: params.id }, data: { status: "ACTIVE" } });
  await logAdminAction({
    adminEmail,
    targetUserId: user.id,
    targetEmail: user.email,
    targetName: user.name,
    action: "REACTIVATE",
  });
  return NextResponse.json({ ok: true });
});
