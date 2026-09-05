import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkTemplateLimit } from "@/lib/billing";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await prisma.template.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const limitCheck = await checkTemplateLimit(userId);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const template = await prisma.template.create({
    data: {
      userId,
      name: `${existing.name} (copy)`,
      subject: existing.subject,
      body: existing.body,
      categoryId: existing.categoryId,
    },
  });

  return NextResponse.json({ template }, { status: 201 });
});
