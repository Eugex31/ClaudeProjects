import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "SENDING" && campaign.status !== "PAUSED") {
    return NextResponse.json({ error: "Only a sending or paused campaign can be stopped" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.campaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: { in: ["PENDING", "RETRYING"] } },
      data: { status: "SKIPPED" },
    }),
    prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "STOPPED", completedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
});
