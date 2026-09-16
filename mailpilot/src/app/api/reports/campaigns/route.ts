import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth(async (_req, { userId }) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
      _count: { select: { recipients: { where: { status: "SENT" } } } },
    },
  });

  // Aggregated in JS rather than a raw SQL "count distinct" — campaign sizes
  // here are bounded by the plan tier caps (tens of thousands at most), so
  // this is cheap at dashboard-load time and avoids reaching for raw SQL for
  // something Prisma's query builder can't express directly (groupBy has no
  // COUNT(DISTINCT ...) equivalent).
  const events = await prisma.emailEvent.findMany({
    where: { campaign: { userId } },
    select: { campaignId: true, recipientId: true, type: true },
  });

  const uniqueOpens = new Map<string, Set<string>>();
  const uniqueClicks = new Map<string, Set<string>>();
  const totalOpens = new Map<string, number>();
  const totalClicks = new Map<string, number>();

  for (const e of events) {
    const opens = e.type === "OPEN" ? uniqueOpens : uniqueClicks;
    const totals = e.type === "OPEN" ? totalOpens : totalClicks;
    if (!opens.has(e.campaignId)) opens.set(e.campaignId, new Set());
    opens.get(e.campaignId)!.add(e.recipientId);
    totals.set(e.campaignId, (totals.get(e.campaignId) ?? 0) + 1);
  }

  const report = campaigns.map((c) => {
    const sent = c._count.recipients;
    const uOpens = uniqueOpens.get(c.id)?.size ?? 0;
    const uClicks = uniqueClicks.get(c.id)?.size ?? 0;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      updatedAt: c.updatedAt,
      sent,
      uniqueOpens: uOpens,
      totalOpens: totalOpens.get(c.id) ?? 0,
      uniqueClicks: uClicks,
      totalClicks: totalClicks.get(c.id) ?? 0,
      openRate: sent > 0 ? Math.round((uOpens / sent) * 1000) / 10 : null,
      clickRate: sent > 0 ? Math.round((uClicks / sent) * 1000) / 10 : null,
      clickToOpenRate: uOpens > 0 ? Math.round((uClicks / uOpens) * 1000) / 10 : null,
    };
  });

  return NextResponse.json({ campaigns: report });
});
