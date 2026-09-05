import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

const logsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["PENDING", "SENDING", "SENT", "FAILED", "RETRYING", "SKIPPED"]).optional(),
  campaignId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { q, status, campaignId, page, pageSize } = logsQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const where: Prisma.CampaignRecipientWhereInput = {
    campaign: { userId },
    ...(status ? { status } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(q
      ? {
          contact: {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contact: { select: { email: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
    prisma.campaignRecipient.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, pageSize });
});
