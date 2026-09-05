import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const DELETE = withAuth<{ id: string; enrollmentId: string }>(async (_req, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const { count } = await prisma.sequenceEnrollment.updateMany({
    where: { id: params.enrollmentId, sequenceId: sequence.id, status: "ACTIVE" },
    data: { status: "CANCELED", nextSendAt: null },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Enrollment not found or already finished" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
