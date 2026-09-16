import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { sequenceStepInputSchema } from "@/lib/validation/sequence.schema";

async function loadOwnedSequence(id: string, userId: string) {
  return prisma.sequence.findFirst({ where: { id, userId } });
}

export const PATCH = withAuth<{ id: string; stepId: string }>(async (req, { userId, params }) => {
  const sequence = await loadOwnedSequence(params.id, userId);
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (sequence.status === "ACTIVE") {
    return NextResponse.json({ error: "Pause the sequence before editing its steps" }, { status: 409 });
  }

  const existingStep = await prisma.sequenceStep.findFirst({
    where: { id: params.stepId, sequenceId: sequence.id },
  });
  if (!existingStep) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const body = sequenceStepInputSchema.parse(await req.json());
  const step = await prisma.sequenceStep.update({ where: { id: params.stepId }, data: body });
  return NextResponse.json({ step });
});

export const DELETE = withAuth<{ id: string; stepId: string }>(async (_req, { userId, params }) => {
  const sequence = await loadOwnedSequence(params.id, userId);
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (sequence.status === "ACTIVE") {
    return NextResponse.json({ error: "Pause the sequence before editing its steps" }, { status: 409 });
  }

  const existingStep = await prisma.sequenceStep.findFirst({
    where: { id: params.stepId, sequenceId: sequence.id },
  });
  if (!existingStep) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const remaining = await prisma.sequenceStep.findMany({
    where: { sequenceId: sequence.id, id: { not: params.stepId } },
    orderBy: { order: "asc" },
  });

  // Renumber to close the gap — order must stay a dense 0..n-1 sequence
  // since SequenceEnrollment.currentStep indexes into it directly.
  await prisma.$transaction([
    prisma.sequenceStep.delete({ where: { id: params.stepId } }),
    ...remaining.map((step, index) =>
      prisma.sequenceStep.update({ where: { id: step.id }, data: { order: index } })
    ),
  ]);

  return NextResponse.json({ ok: true });
});
