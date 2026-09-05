import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { computeSchedule } from "@/lib/scheduling";
import { checkRateLimit } from "@/lib/rateLimit";
import { checkTierLimit } from "@/lib/billing";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const allowed = await checkRateLimit(`campaign-start:${userId}`, 20, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many campaigns started recently. Try again later." }, { status: 429 });
  }

  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft campaigns can be started" }, { status: 409 });
  }
  if (!campaign.subject.trim() || !campaign.body.trim()) {
    return NextResponse.json({ error: "Add a subject and body before starting" }, { status: 400 });
  }

  const pendingRecipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (pendingRecipients.length === 0) {
    return NextResponse.json({ error: "Add at least one recipient before starting" }, { status: 400 });
  }

  const limitCheck = await checkTierLimit(userId, "emails", pendingRecipients.length);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const schedule = computeSchedule(pendingRecipients.length, campaign.delayMinSeconds, campaign.delayMaxSeconds);

  await prisma.$transaction([
    ...pendingRecipients.map((r, i) =>
      prisma.campaignRecipient.update({ where: { id: r.id }, data: { scheduledAt: schedule[i] } })
    ),
    prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENDING", startedAt: new Date(), pausedAt: null, completedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true });
});
