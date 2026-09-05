import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { adminCustomerListQuerySchema } from "@/lib/validation/admin.schema";

// One joined query, no per-row aggregates — deliberately kept cheap since
// this list can grow with every signup. Per-customer usage detail lives on
// GET /api/admin/customers/[id] instead, where a couple of extra counts for
// a single row is fine.
export const GET = withAdminAuth(async (req: NextRequest) => {
  const { q, page, pageSize } = adminCustomerListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const where: Prisma.UserWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        subscription: { select: { status: true, plan: { select: { name: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const customers = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    planName: u.subscription && u.subscription.status !== "CANCELED" ? u.subscription.plan.name : "Free",
    billingStatus: u.subscription?.status ?? "ACTIVE",
  }));

  return NextResponse.json({ customers, total, page, pageSize });
});
