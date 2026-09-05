import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "SENDING") {
    return NextResponse.json({ error: "Only a sending campaign can be paused" }, { status: 409 });
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "PAUSED", pausedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
