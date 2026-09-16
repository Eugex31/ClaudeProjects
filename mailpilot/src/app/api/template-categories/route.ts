import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

const querySchema = z.object({ tab: z.enum(["starter", "mine"]) });

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { tab } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  const categories = await prisma.templateCategory.findMany({ orderBy: { sortOrder: "asc" } });

  let counts: Map<string | null, number>;
  let total: number;
  let starred: number;

  if (tab === "starter") {
    const [groups, totalCount, starredCount] = await Promise.all([
      prisma.starterTemplate.groupBy({ by: ["categoryId"], _count: { _all: true } }),
      prisma.starterTemplate.count(),
      prisma.starterTemplateFavorite.count({ where: { userId } }),
    ]);
    counts = new Map(groups.map((g) => [g.categoryId, g._count._all]));
    total = totalCount;
    starred = starredCount;
  } else {
    const [groups, totalCount, starredCount] = await Promise.all([
      prisma.template.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
      prisma.template.count({ where: { userId } }),
      prisma.template.count({ where: { userId, isFavorite: true } }),
    ]);
    counts = new Map(groups.map((g) => [g.categoryId, g._count._all]));
    total = totalCount;
    starred = starredCount;
  }

  return NextResponse.json({
    all: { key: "all", label: "All", count: total },
    starred: { key: "starred", label: "Starred", count: starred },
    categories: categories.map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      count: counts.get(c.id) ?? 0,
    })),
  });
});
