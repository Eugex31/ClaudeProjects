import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId: campaign.id },
    _count: { _all: true },
  });

  const counts = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, RETRYING: 0, SKIPPED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return NextResponse.json({ status: campaign.status, total, counts });
});
