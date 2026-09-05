import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { newsletterUpdateSchema } from "@/lib/validation/newsletter.schema";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const newsletter = await prisma.newsletter.findFirst({
    where: { id: params.id, userId },
    include: {
      template: { select: { id: true, name: true } },
      targetTag: { select: { id: true, name: true } },
    },
  });
  if (!newsletter) {
    return NextResponse.json({ error: "Newsletter not found" }, { status: 404 });
  }
  return NextResponse.json({ newsletter });
});

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const existing = await prisma.newsletter.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Newsletter not found" }, { status: 404 });
  }

  const body = newsletterUpdateSchema.parse(await req.json());
  if (body.templateId) {
    const template = await prisma.template.findFirst({ where: { id: body.templateId, userId } });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 400 });
    }
  }
  if (body.targetTagId) {
    const tag = await prisma.tag.findFirst({ where: { id: body.targetTagId, userId } });
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 400 });
    }
  }

  const newsletter = await prisma.newsletter.update({ where: { id: params.id }, data: body });
  return NextResponse.json({ newsletter });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { count } = await prisma.newsletter.deleteMany({ where: { id: params.id, userId } });
  if (count === 0) {
    return NextResponse.json({ error: "Newsletter not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
