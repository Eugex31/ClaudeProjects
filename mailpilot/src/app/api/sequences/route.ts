import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { sequenceCreateSchema } from "@/lib/validation/sequence.schema";

export const GET = withAuth(async (_req, { userId }) => {
  const sequences = await prisma.sequence.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  return NextResponse.json({
    sequences: sequences.map((s) => ({ ...s, activeEnrollmentCount: s._count.enrollments })),
  });
});

export const POST = withAuth(async (req, { userId }) => {
  const { name } = sequenceCreateSchema.parse(await req.json());
  const sequence = await prisma.sequence.create({ data: { userId, name } });
  return NextResponse.json({ sequence }, { status: 201 });
});
