import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { templateInputSchema, templateListQuerySchema } from "@/lib/validation/template.schema";
import { checkTemplateLimit } from "@/lib/billing";

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { categoryId, search, starred } = templateListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const where: Prisma.TemplateWhereInput = {
    userId,
    ...(categoryId ? { categoryId } : {}),
    ...(starred ? { isFavorite: true } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  };

  const templates = await prisma.template.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ templates });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = templateInputSchema.parse(await req.json());

  const limitCheck = await checkTemplateLimit(userId);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const template = await prisma.template.create({ data: { ...body, userId } });
  return NextResponse.json({ template }, { status: 201 });
});
