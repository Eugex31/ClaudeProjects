import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const DELETE = withAuth<{ id: string; recipientId: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status === "SENDING") {
    return NextResponse.json({ error: "Cannot modify recipients while the campaign is sending" }, { status: 409 });
  }

  const { count } = await prisma.campaignRecipient.deleteMany({
    where: { id: params.recipientId, campaignId: params.id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
