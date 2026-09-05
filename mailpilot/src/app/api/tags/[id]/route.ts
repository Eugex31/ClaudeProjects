import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { tagInputSchema } from "@/lib/validation/tag.schema";

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const existing = await prisma.tag.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  const { name } = tagInputSchema.parse(await req.json());
  try {
    const tag = await prisma.tag.update({ where: { id: params.id }, data: { name } });
    return NextResponse.json({ tag });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 });
    }
    throw err;
  }
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await prisma.tag.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  await prisma.tag.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
