import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { campaignCreateSchema } from "@/lib/validation/campaign.schema";

export const GET = withAuth(async (_req, { userId }) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });
  return NextResponse.json({ campaigns });
});

export const POST = withAuth(async (req, { userId }) => {
  const { name } = campaignCreateSchema.parse(await req.json());
  const campaign = await prisma.campaign.create({
    data: { userId, name, subject: "", body: "" },
  });
  return NextResponse.json({ campaign }, { status: 201 });
});
