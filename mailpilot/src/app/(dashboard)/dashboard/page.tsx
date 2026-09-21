import Link from "next/link";
import {
  Send,
  Clock,
  XCircle,
  TrendingUp,
  MailOpen,
  MousePointerClick,
  Share2,
  CalendarClock,
  CheckCircle2,
  Eye,
  Heart,
  MessageCircle,
  UserPlus,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveEffectiveUserId } from "@/lib/activeProfile";
import { getDashboardSummary } from "@/lib/dashboardSummary";
import { StatCard } from "@/components/dashboard/stat-card";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await auth();
  const { userId } = await resolveEffectiveUserId(session!.user!.id);
  const summary = await getDashboardSummary(userId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {session?.user?.name ?? session?.user?.email}.</p>
      </div>

      {summary.totalCampaigns === 0 && (
        <GettingStarted gmailConnected={summary.gmailConnected} contactCount={summary.contactCount} />
      )}

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Email</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Campaigns" value={summary.totalCampaigns} icon={TrendingUp} />
          <StatCard label="Emails sent" value={summary.emailsSent} icon={Send} />
          <StatCard label="Pending" value={summary.emailsPending} icon={Clock} />
          <StatCard label="Failed" value={summary.emailsFailed} icon={XCircle} />
          <StatCard label="Opens" value={summary.uniqueOpens} icon={MailOpen} />
          <StatCard label="Clicks" value={summary.uniqueClicks} icon={MousePointerClick} />
        </div>
      </div>

      {summary.successRate !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Success rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary.successRate}%</div>
          </CardContent>
        </Card>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Social</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Posts" value={summary.totalSocialPosts} icon={Share2} />
          <StatCard label="Published" value={summary.socialPublished} icon={CheckCircle2} />
          <StatCard label="Scheduled" value={summary.socialScheduled} icon={CalendarClock} />
          <StatCard label="Failed" value={summary.socialFailed} icon={XCircle} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Views" value={summary.socialViews} icon={Eye} />
          <StatCard label="Likes" value={summary.socialLikes} icon={Heart} />
          <StatCard label="Comments" value={summary.socialComments} icon={MessageCircle} />
          <StatCard label="New followers" value={summary.newFollowers} icon={UserPlus} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Recent campaigns</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No campaigns yet.</p>
            ) : (
              summary.campaigns.map((c) => (
                <Link
                  key={c.id}
                  href={`/campaigns/${c.id}`}
                  className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{c.name}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{c._count.recipients} recipients</span>
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              summary.recentActivity.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.campaign.name}</span>
                    <span className="text-muted-foreground">
                      {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email}
                    </span>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent social posts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.recentSocialPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No social posts yet.{" "}
                <Link href="/social" className="underline">
                  Connect an account
                </Link>{" "}
                to get started.
              </p>
            ) : (
              summary.recentSocialPosts.map((p) => {
                const hasMetrics = p.viewCount !== null || p.likeCount !== null || p.commentCount !== null;
                return (
                  <Link
                    key={p.id}
                    href="/social"
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-accent"
                  >
                    <div className="flex flex-col overflow-hidden">
                      <span className="font-medium">{p.socialAccount.displayName}</span>
                      <span className="truncate text-muted-foreground">{p.caption || "(no caption)"}</span>
                      {hasMetrics && (
                        <span className="mt-0.5 text-xs text-muted-foreground">
                          {p.viewCount !== null && `${p.viewCount.toLocaleString()} views`}
                          {p.viewCount !== null && (p.likeCount !== null || p.commentCount !== null) && " · "}
                          {p.likeCount !== null && `${p.likeCount.toLocaleString()} likes`}
                          {p.likeCount !== null && p.commentCount !== null && " · "}
                          {p.commentCount !== null && `${p.commentCount.toLocaleString()} comments`}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
