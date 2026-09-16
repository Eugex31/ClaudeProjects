import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      name: `${existing.name} (copy)`,
      subject: existing.subject,
      body: existing.body,
      delayMinSeconds: existing.delayMinSeconds,
      delayMaxSeconds: existing.delayMaxSeconds,
      dailySendLimitOverride: existing.dailySendLimitOverride,
      senderNameOverride: existing.senderNameOverride,
      replyToOverride: existing.replyToOverride,
      unsubscribeFooterEnabled: existing.unsubscribeFooterEnabled,
    },
  });

  return NextResponse.json({ campaign }, { status: 201 });
});
