import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const starterTemplate = await prisma.starterTemplate.findUnique({ where: { id: params.id } });
  if (!starterTemplate) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const existing = await prisma.starterTemplateFavorite.findUnique({
    where: { userId_starterTemplateId: { userId, starterTemplateId: params.id } },
  });

  if (existing) {
    await prisma.starterTemplateFavorite.delete({
      where: { userId_starterTemplateId: { userId, starterTemplateId: params.id } },
    });
    return NextResponse.json({ isFavorite: false });
  }

  await prisma.starterTemplateFavorite.create({ data: { userId, starterTemplateId: params.id } });
  return NextResponse.json({ isFavorite: true });
});
