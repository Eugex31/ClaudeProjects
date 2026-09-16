import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { sequenceUpdateSchema } from "@/lib/validation/sequence.schema";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({
    where: { id: params.id, userId },
    include: {
      steps: { orderBy: { order: "asc" } },
      triggerTag: { select: { id: true, name: true } },
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  return NextResponse.json({ sequence: { ...sequence, activeEnrollmentCount: sequence._count.enrollments } });
});

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const existing = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const body = sequenceUpdateSchema.parse(await req.json());
  if (body.triggerTagId) {
    const tag = await prisma.tag.findFirst({ where: { id: body.triggerTagId, userId } });
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 400 });
    }
  }

  const sequence = await prisma.sequence.update({ where: { id: params.id }, data: body });
  return NextResponse.json({ sequence });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { count } = await prisma.sequence.deleteMany({ where: { id: params.id, userId } });
  if (count === 0) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
