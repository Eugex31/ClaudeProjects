import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, userId },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { recipients: { where: { status: "SENT" } } } },
    },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const events = await prisma.emailEvent.findMany({
    where: { campaignId: campaign.id },
    select: { recipientId: true, type: true, url: true },
  });

  const uniqueOpens = new Set<string>();
  const uniqueClicks = new Set<string>();
  let totalOpens = 0;
  let totalClicks = 0;
  const linkStats = new Map<string, { totalClicks: number; clickers: Set<string> }>();

  for (const e of events) {
    if (e.type === "OPEN") {
      uniqueOpens.add(e.recipientId);
      totalOpens += 1;
    } else {
      uniqueClicks.add(e.recipientId);
      totalClicks += 1;
      if (e.url) {
        if (!linkStats.has(e.url)) linkStats.set(e.url, { totalClicks: 0, clickers: new Set() });
        const stat = linkStats.get(e.url)!;
        stat.totalClicks += 1;
        stat.clickers.add(e.recipientId);
      }
    }
  }

  const sent = campaign._count.recipients;
  const topLinks = [...linkStats.entries()]
    .map(([url, stat]) => ({ url, totalClicks: stat.totalClicks, uniqueClicks: stat.clickers.size }))
    .sort((a, b) => b.uniqueClicks - a.uniqueClicks)
    .slice(0, 10);

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sent,
      uniqueOpens: uniqueOpens.size,
      totalOpens,
      uniqueClicks: uniqueClicks.size,
      totalClicks,
      openRate: sent > 0 ? Math.round((uniqueOpens.size / sent) * 1000) / 10 : null,
      clickRate: sent > 0 ? Math.round((uniqueClicks.size / sent) * 1000) / 10 : null,
      clickToOpenRate: uniqueOpens.size > 0 ? Math.round((uniqueClicks.size / uniqueOpens.size) * 1000) / 10 : null,
      topLinks,
    },
  });
});
