import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { tagInputSchema } from "@/lib/validation/tag.schema";

export const GET = withAuth(async (_req, { userId }) => {
  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { contacts: true } } },
  });
  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, contactCount: t._count.contacts })),
  });
});

export const POST = withAuth(async (req, { userId }) => {
  const { name } = tagInputSchema.parse(await req.json());

  try {
    const tag = await prisma.tag.create({ data: { userId, name } });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 });
    }
    throw err;
  }
});
