import Link from "next/link";

import { requireOrg } from "@/lib/auth/context";
import { getDashboardData, formatBytes } from "@/lib/dashboard";
import { PageHeader } from "@/components/app/page-header";
import { StatTile } from "@/components/app/stat-tile";
import { OnboardingChecklist } from "@/components/app/onboarding-checklist";
import { RecentActivity } from "@/components/app/recent-activity";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Dashboard" };

/**
 * Landing route for every authenticated flow. Aggregates live metrics for the
 * active organization through the tenant facade, leads with the onboarding
 * checklist while setup is unfinished, then shows KPI tiles and recent activity.
 */
export default async function DashboardPage() {
  const ctx = await requireOrg();
  const data = await getDashboardData(ctx.organizationId);

  const { onboarding, screens, locations, members, usage, recentActivity } = data;
  const setupIncomplete = Object.values(onboarding).some((done) => !done);

  const storageLimitLabel =
    usage.storage.limitBytes == null ? "Unlimited" : formatBytes(usage.storage.limitBytes);
  const storageTone =
    usage.storage.limitBytes != null &&
    usage.storage.usedBytes * BigInt(10) >= usage.storage.limitBytes * BigInt(9)
      ? "warning"
      : "default";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="A live view of your screen network, plan usage, and recent changes."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/screens">Add screen</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/locations">Add location</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/users">Invite teammate</Link>
            </Button>
          </>
        }
      />

      {setupIncomplete ? <OnboardingChecklist onboarding={onboarding} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Screens"
          value={screens.total}
          hint={`${screens.online} online, ${screens.offline} offline`}
        />
        <StatTile label="Locations" value={locations} />
        <StatTile label="Team members" value={members} />
        <StatTile
          label="Storage used"
          value={formatBytes(usage.storage.usedBytes)}
          hint={`of ${storageLimitLabel}`}
          tone={storageTone}
        />
      </div>

      <RecentActivity items={recentActivity} />
    </div>
  );
}
