import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await prisma.template.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const template = await prisma.template.update({
    where: { id: params.id },
    data: { isFavorite: !existing.isFavorite },
  });
  return NextResponse.json({ template });
});
