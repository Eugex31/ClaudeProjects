import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (sequence.status !== "ACTIVE") {
    return NextResponse.json({ error: "Only an active sequence can be paused" }, { status: 409 });
  }

  await prisma.sequence.update({ where: { id: sequence.id }, data: { status: "PAUSED" } });
  return NextResponse.json({ ok: true });
});
