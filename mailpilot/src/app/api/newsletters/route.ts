import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { newsletterCreateSchema } from "@/lib/validation/newsletter.schema";

export const GET = withAuth(async (_req, { userId }) => {
  const newsletters = await prisma.newsletter.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      template: { select: { id: true, name: true } },
      targetTag: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ newsletters });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = newsletterCreateSchema.parse(await req.json());

  const template = await prisma.template.findFirst({ where: { id: body.templateId, userId } });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 400 });
  }
  if (body.targetTagId) {
    const tag = await prisma.tag.findFirst({ where: { id: body.targetTagId, userId } });
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 400 });
    }
  }

  const newsletter = await prisma.newsletter.create({ data: { ...body, userId } });
  return NextResponse.json({ newsletter }, { status: 201 });
});
