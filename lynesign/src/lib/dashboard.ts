import type { ScreenStatus } from "@prisma/client";

import { withOrgTransaction } from "@/lib/db/tenant";
import { getUsageSummary } from "@/lib/plan-limits";

// Re-exported so existing `@/lib/dashboard` importers keep working. The
// implementation now lives in a database-free module that client components can
// import safely.
export { formatBytes } from "@/lib/format";

/**
 * Aggregated landing-page data for one organization. Every org-scoped read runs
 * inside a single `withOrgTransaction`, so one dashboard load checks out one
 * pooled connection rather than one per query. `getUsageSummary` is separate: it
 * uses the root client with an explicit `organizationId` filter.
 */
export interface DashboardData {
  screens: { total: number; online: number; offline: number; unpaired: number };
  locations: number;
  members: number;
  usage: Awaited<ReturnType<typeof getUsageSummary>>;
  recentActivity: RecentActivityItem[];
  onboarding: {
    hasLocation: boolean;
    hasScreen: boolean;
    hasPairedScreen: boolean;
    hasTeammate: boolean;
  };
}

export interface RecentActivityItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorId: string | null;
  createdAt: Date;
}

interface DerivableScreen {
  status: ScreenStatus;
  lastSeenAt: Date | null;
  pollIntervalSeconds: number;
}

/**
 * A screen is ONLINE only when its stored status says so AND it has reported in
 * within three poll intervals. A stale `ONLINE` row is treated as offline.
 */
function isOnline(screen: DerivableScreen, nowMs: number): boolean {
  if (screen.status !== "ONLINE") return false;
  if (!screen.lastSeenAt) return false;
  const staleAfterMs = screen.pollIntervalSeconds * 3 * 1000;
  return nowMs - screen.lastSeenAt.getTime() <= staleAfterMs;
}

export async function getDashboardData(organizationId: string): Promise<DashboardData> {
  // One transaction, one connection. Each `forOrg` call would open its own
  // interactive transaction; four of them in a Promise.all raced for the pool on
  // every dashboard load. The queries below share this one connection, so they
  // run sequentially on it rather than concurrently.
  const [tenant, usage] = await Promise.all([
    withOrgTransaction(organizationId, async (tx) => {
      const screens = await tx.screen.findMany({
        select: {
          status: true,
          lastSeenAt: true,
          pollIntervalSeconds: true,
          deviceTokenHash: true,
        },
      });
      const locations = await tx.location.count();
      const members = await tx.membership.count({ where: { status: "ACTIVE" } });
      const recent = await tx.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
      return { screens, locations, members, recent };
    }),
    getUsageSummary(organizationId),
  ]);
  const { screens, locations, members, recent } = tenant;

  const nowMs = Date.now();
  let online = 0;
  let unpaired = 0;
  for (const screen of screens) {
    if (screen.status === "UNPAIRED" || screen.deviceTokenHash == null) unpaired += 1;
    if (isOnline(screen, nowMs)) online += 1;
  }
  const total = screens.length;
  const offline = total - online;
  const hasPairedScreen = screens.some((screen) => screen.deviceTokenHash != null);

  return {
    screens: { total, online, offline, unpaired },
    locations,
    members,
    usage,
    recentActivity: recent.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      actorId: row.actorId,
      createdAt: row.createdAt,
    })),
    onboarding: {
      hasLocation: locations > 0,
      hasScreen: total > 0,
      hasPairedScreen,
      hasTeammate: members > 1,
    },
  };
}
