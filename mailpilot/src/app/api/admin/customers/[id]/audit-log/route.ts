import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";

export const GET = withAdminAuth<{ id: string }>(async (_req, { params }) => {
  const entries = await prisma.adminAuditLog.findMany({
    where: { targetUserId: params.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ entries });
});
