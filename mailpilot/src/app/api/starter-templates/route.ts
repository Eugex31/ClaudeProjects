import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { templateListQuerySchema } from "@/lib/validation/template.schema";

// Platform-wide starter content — withAuth-wrapped (still requires a logged-in
// session) but the query itself carries no userId filter, same precedent as
// prisma.plan.findMany() in src/app/api/billing/summary/route.ts. Favorite
// status is joined in per the current user, since starring shared content is
// inherently a per-customer relationship, not a property of the shared row.
export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { categoryId, search, starred } = templateListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const where: Prisma.StarterTemplateWhereInput = {
    ...(categoryId ? { categoryId } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    ...(starred ? { favorites: { some: { userId } } } : {}),
  };

  const templates = await prisma.starterTemplate.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { favorites: { where: { userId }, select: { userId: true } } },
  });

  return NextResponse.json({
    templates: templates.map(({ favorites, ...t }) => ({ ...t, isFavorite: favorites.length > 0 })),
  });
});
