import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { computeSchedule } from "@/lib/scheduling";
import { checkTierLimit } from "@/lib/billing";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "STOPPED") {
    return NextResponse.json({ error: "Only a stopped campaign can be restarted" }, { status: 409 });
  }

  const skipped = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "SKIPPED" },
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });
  if (skipped.length === 0) {
    return NextResponse.json(
      { error: "Nothing to restart — every recipient was already sent to or failed" },
      { status: 400 }
    );
  }

  const limitCheck = await checkTierLimit(userId, "emails", skipped.length);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const schedule = computeSchedule(skipped.length, campaign.delayMinSeconds, campaign.delayMaxSeconds);

  await prisma.$transaction([
    ...skipped.map((r, i) =>
      prisma.campaignRecipient.update({
        where: { id: r.id },
        data: { status: "PENDING", scheduledAt: schedule[i] },
      })
    ),
    prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENDING", completedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true, requeued: skipped.length });
});
