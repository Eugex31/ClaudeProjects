import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { sequenceStepInputSchema } from "@/lib/validation/sequence.schema";

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (sequence.status === "ACTIVE") {
    return NextResponse.json({ error: "Pause the sequence before editing its steps" }, { status: 409 });
  }

  const body = sequenceStepInputSchema.parse(await req.json());
  const last = await prisma.sequenceStep.findFirst({
    where: { sequenceId: sequence.id },
    orderBy: { order: "desc" },
  });

  const step = await prisma.sequenceStep.create({
    data: { ...body, sequenceId: sequence.id, order: (last?.order ?? -1) + 1 },
  });
  return NextResponse.json({ step }, { status: 201 });
});
