import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const connection = await prisma.aiConnection.findFirst({ where: { id: params.id, userId } });
  if (!connection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.aiConnection.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.aiConnection.update({ where: { id: connection.id }, data: { isDefault: true } }),
  ]);

  return NextResponse.json({ success: true });
});
