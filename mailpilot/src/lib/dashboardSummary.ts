import { prisma } from "@/lib/prisma";
import { getConnectedGmailAddress } from "@/lib/gmail/getGmailClient";

export async function getDashboardSummary(userId: string) {
  const [
    totalCampaigns,
    contactCount,
    connectedGmailAddress,
    statusGroups,
    recentActivity,
    campaigns,
    events,
    socialStatusGroups,
    recentSocialPosts,
    socialMetricsSum,
    socialAccountsWithSnapshots,
  ] = await Promise.all([
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
    prisma.socialPost.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.socialPost.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        caption: true,
        status: true,
        updatedAt: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        socialAccount: { select: { displayName: true, platform: true } },
      },
    }),
    prisma.socialPost.aggregate({
      where: { userId },
      _sum: { viewCount: true, likeCount: true, commentCount: true },
    }),
    prisma.socialAccount.findMany({
      where: { userId },
      select: {
        id: true,
        snapshots: {
          where: { capturedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          orderBy: { capturedAt: "asc" },
          select: { followerCount: true },
        },
      },
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

  const socialCounts = { DRAFT: 0, SCHEDULED: 0, PUBLISHING: 0, PUBLISHED: 0, FAILED: 0 };
  for (const g of socialStatusGroups) {
    socialCounts[g.status as keyof typeof socialCounts] = g._count._all;
  }
  const totalSocialPosts = Object.values(socialCounts).reduce((a, b) => a + b, 0);

  // Per account: latest snapshot in the last 30 days minus the oldest one in
  // that same window. An account with only one snapshot so far has no real
  // delta yet (not enough history), so it contributes 0, not a false count.
  const newFollowers = socialAccountsWithSnapshots.reduce((total, account) => {
    if (account.snapshots.length < 2) return total;
    const oldest = account.snapshots[0].followerCount;
    const newest = account.snapshots[account.snapshots.length - 1].followerCount;
    return total + Math.max(0, newest - oldest);
  }, 0);

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
    totalSocialPosts,
    socialPublished: socialCounts.PUBLISHED,
    socialScheduled: socialCounts.SCHEDULED,
    socialFailed: socialCounts.FAILED,
    recentSocialPosts,
    socialViews: socialMetricsSum._sum.viewCount ?? 0,
    socialLikes: socialMetricsSum._sum.likeCount ?? 0,
    socialComments: socialMetricsSum._sum.commentCount ?? 0,
    newFollowers,
  };
}
