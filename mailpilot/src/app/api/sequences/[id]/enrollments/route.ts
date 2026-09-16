import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { addEnrollmentsSchema } from "@/lib/validation/sequence.schema";

export const GET = withAuth<{ id: string }>(async (req: NextRequest, { userId, params }) => {
  const sequence = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25")));

  const [enrollments, total] = await Promise.all([
    prisma.sequenceEnrollment.findMany({
      where: { sequenceId: params.id },
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sequenceEnrollment.count({ where: { sequenceId: params.id } }),
  ]);

  return NextResponse.json({ enrollments, total, page, pageSize });
});

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { contactIds } = addEnrollmentsSchema.parse(await req.json());

  const sequence = await prisma.sequence.findFirst({ where: { id: params.id, userId } });
  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const firstStep = await prisma.sequenceStep.findUnique({
    where: { sequenceId_order: { sequenceId: sequence.id, order: 0 } },
  });
  if (!firstStep) {
    return NextResponse.json({ error: "Add at least one step before enrolling contacts" }, { status: 400 });
  }

  const ownedContacts = await prisma.contact.findMany({
    where: { userId, id: { in: contactIds } },
    select: { id: true },
  });
  const ownedIds = new Set(ownedContacts.map((c) => c.id));

  const nextSendAt = new Date(Date.now() + firstStep.delaySeconds * 1000);
  const result = await prisma.sequenceEnrollment.createMany({
    data: contactIds
      .filter((id) => ownedIds.has(id))
      .map((contactId) => ({ sequenceId: sequence.id, contactId, nextSendAt })),
    skipDuplicates: true,
  });

  return NextResponse.json({ added: result.count });
});
