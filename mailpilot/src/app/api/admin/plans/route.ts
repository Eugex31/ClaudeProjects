import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";

// Small supporting endpoint for the manual plan-assignment dialog — Plan is
// a static, non-sensitive tier table, same shape already exposed to
// customers via GET /api/billing/summary, just admin-scoped here.
export const GET = withAdminAuth(async () => {
  const plans = await prisma.plan.findMany({ orderBy: { monthlyPriceCents: "asc" } });
  return NextResponse.json({ plans });
});
