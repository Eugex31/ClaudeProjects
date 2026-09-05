import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { computeSchedule } from "@/lib/scheduling";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "PAUSED") {
    return NextResponse.json({ error: "Only a paused campaign can be resumed" }, { status: 409 });
  }

  const remaining = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: { in: ["PENDING", "RETRYING"] } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });

  const schedule = computeSchedule(remaining.length, campaign.delayMinSeconds, campaign.delayMaxSeconds);

  await prisma.$transaction([
    ...remaining.map((r, i) =>
      prisma.campaignRecipient.update({ where: { id: r.id }, data: { scheduledAt: schedule[i] } })
    ),
    prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENDING", pausedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true });
});
