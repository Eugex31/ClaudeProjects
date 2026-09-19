import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const connection = await prisma.aiConnection.findFirst({ where: { id: params.id, userId } });
  if (!connection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.aiConnection.delete({ where: { id: connection.id } });

  // If the deleted connection was the default, promote the oldest remaining
  // one so there's always a clear default when at least one connection
  // exists — mirrors how a deleted default payment method would need a
  // successor, just without Stripe's own such promotion to lean on here.
  if (connection.isDefault) {
    const next = await prisma.aiConnection.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (next) {
      await prisma.aiConnection.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  return NextResponse.json({ success: true });
});
