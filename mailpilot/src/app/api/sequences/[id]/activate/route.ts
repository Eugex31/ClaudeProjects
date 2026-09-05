import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkSequenceLimit } from "@/lib/billing";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({
    where: { id: params.id, userId },
    include: { steps: { select: { id: true } } },
  });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (sequence.status === "ACTIVE") {
    return NextResponse.json({ error: "Sequence is already active" }, { status: 409 });
  }
  if (sequence.steps.length === 0) {
    return NextResponse.json({ error: "Add at least one step before activating" }, { status: 400 });
  }

  const limitCheck = await checkSequenceLimit(userId);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  await prisma.sequence.update({ where: { id: sequence.id }, data: { status: "ACTIVE" } });
  return NextResponse.json({ ok: true });
});
