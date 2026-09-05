import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

const reorderSchema = z.object({ stepIds: z.array(z.string().min(1)).min(1) });

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (sequence.status === "ACTIVE") {
    return NextResponse.json({ error: "Pause the sequence before editing its steps" }, { status: 409 });
  }

  const { stepIds } = reorderSchema.parse(await req.json());
  const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: sequence.id } });
  const ownedIds = new Set(steps.map((s) => s.id));
  if (stepIds.length !== steps.length || !stepIds.every((id) => ownedIds.has(id))) {
    return NextResponse.json({ error: "stepIds must include every step in this sequence exactly once" }, { status: 400 });
  }

  // Same "vacate before reassign" ordering guarantee as steps/[stepId]'s
  // delete-and-renumber: process in the caller's requested final order so
  // any two steps swapping positions never collide against the unique
  // (sequenceId, order) constraint mid-transaction. Offsetting into a high
  // range first, then down to the real 0..n-1 values, makes this safe
  // regardless of the requested order (not just monotonic shifts).
  await prisma.$transaction([
    ...stepIds.map((id, index) => prisma.sequenceStep.update({ where: { id }, data: { order: index + 1000 } })),
    ...stepIds.map((id, index) => prisma.sequenceStep.update({ where: { id }, data: { order: index } })),
  ]);

  return NextResponse.json({ ok: true });
});
