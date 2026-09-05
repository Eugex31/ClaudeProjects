import { prisma } from "@/lib/db/root";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logging";

/**
 * Marks screens OFFLINE once they have missed roughly three poll intervals.
 *
 * Runs unscoped across every organization. The staleness cutoff is per row
 * because `pollIntervalSeconds` varies by screen, so the ONLINE set is loaded
 * and filtered in JS rather than with one fixed interval in SQL. One aggregate
 * SYSTEM audit row is written per affected organization.
 */
export async function sweepOfflineScreens(
  now: Date = new Date(),
): Promise<{ flipped: number }> {
  const online = await prisma.screen.findMany({
    where: { status: "ONLINE", lastSeenAt: { not: null } },
    select: { id: true, organizationId: true, lastSeenAt: true, pollIntervalSeconds: true },
  });

  const stale = online.filter(
    (s) =>
      s.lastSeenAt !== null &&
      now.getTime() - s.lastSeenAt.getTime() > s.pollIntervalSeconds * 3 * 1000,
  );

  if (stale.length === 0) {
    return { flipped: 0 };
  }

  const staleIds = stale.map((s) => s.id);
  const { count } = await prisma.screen.updateMany({
    where: { id: { in: staleIds } },
    data: { status: "OFFLINE" },
  });

  const perOrg = new Map<string, number>();
  for (const s of stale) {
    perOrg.set(s.organizationId, (perOrg.get(s.organizationId) ?? 0) + 1);
  }

  for (const [organizationId, orgCount] of perOrg) {
    await writeAudit({
      organizationId,
      actorType: "SYSTEM",
      action: "screen.offline.sweep",
      targetType: "Screen",
      metadata: { count: orgCount },
    });
  }

  logger.info({ flipped: count, orgs: perOrg.size }, "swept offline screens");
  return { flipped: count };
}
