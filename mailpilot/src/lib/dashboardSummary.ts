import { prisma } from "@/lib/prisma";
import { getConnectedGmailAddress } from "@/lib/gmail/getGmailClient";

export async function getDashboardSummary(userId: string) {
  const [totalCampaigns, contactCount, connectedGmailAddress, statusGroups, recentActivity, campaigns, events] =
    await Promise.all([
    prisma.campaign.count({ where: { userId } }),
    prisma.contact.count({ where: { userId } }),
    getConnectedGmailAddress(userId),
    prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaign: { userId } },
      _count: { _all: true },
    }),
    prisma.campaignRecipient.findMany({
      where: { campaign: { userId }, status: { in: ["SENT", "FAILED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        contact: { select: { email: true, firstName: true, lastName: true } },
        campaign: { select: { name: true } },
      },
    }),
    prisma.campaign.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, name: true, status: true, updatedAt: true, _count: { select: { recipients: true } } },
    }),
    prisma.emailEvent.findMany({
      where: { campaign: { userId } },
      select: { recipientId: true, type: true },
    }),
  ]);

  const counts = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, RETRYING: 0, SKIPPED: 0 };
  for (const g of statusGroups) {
    counts[g.status as keyof typeof counts] = g._count._all;
  }

  const sent = counts.SENT;
  const failed = counts.FAILED;
  const successRate = sent + failed > 0 ? Math.round((sent / (sent + failed)) * 1000) / 10 : null;

  const uniqueOpens = new Set(events.filter((e) => e.type === "OPEN").map((e) => e.recipientId)).size;
  const uniqueClicks = new Set(events.filter((e) => e.type === "CLICK").map((e) => e.recipientId)).size;

  return {
    totalCampaigns,
    contactCount,
    gmailConnected: !!connectedGmailAddress,
    emailsSent: sent,
    emailsPending: counts.PENDING + counts.RETRYING + counts.SENDING,
    emailsFailed: failed,
    successRate,
    uniqueOpens,
    uniqueClicks,
    recentActivity,
    campaigns,
  };
}
