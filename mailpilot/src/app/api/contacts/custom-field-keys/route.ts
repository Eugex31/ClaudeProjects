import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth(async (_req, { userId }) => {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT jsonb_object_keys("customFields") AS key
    FROM "Contact"
    WHERE "userId" = ${userId} AND "customFields" IS NOT NULL
  `;
  return NextResponse.json({ keys: rows.map((r) => r.key) });
});
