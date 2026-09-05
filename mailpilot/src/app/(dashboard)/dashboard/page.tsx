import Link from "next/link";
import { Send, Clock, XCircle, TrendingUp, MailOpen, MousePointerClick } from "lucide-react";
import { auth } from "@/lib/auth";
import { getDashboardSummary } from "@/lib/dashboardSummary";
import { StatCard } from "@/components/dashboard/stat-card";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await auth();
  const summary = await getDashboardSummary(session!.user!.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {session?.user?.name ?? session?.user?.email}.</p>
      </div>

      {summary.totalCampaigns === 0 && (
        <GettingStarted gmailConnected={summary.gmailConnected} contactCount={summary.contactCount} />
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Campaigns" value={summary.totalCampaigns} icon={TrendingUp} />
        <StatCard label="Emails sent" value={summary.emailsSent} icon={Send} />
        <StatCard label="Pending" value={summary.emailsPending} icon={Clock} />
        <StatCard label="Failed" value={summary.emailsFailed} icon={XCircle} />
        <StatCard label="Opens" value={summary.uniqueOpens} icon={MailOpen} />
        <StatCard label="Clicks" value={summary.uniqueClicks} icon={MousePointerClick} />
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

      <div className="grid gap-4 lg:grid-cols-2">
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
      </div>
    </div>
  );
}
