import { prisma } from "@/lib/db/root";
import { PlanLimitError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { PlanKey, type Plan } from "@prisma/client";

/**
 * Resolve the Plan an organization is billed on. Organizations without a
 * Subscription row fall back to the seeded TRIAL plan.
 */
export async function getPlanForOrg(organizationId: string): Promise<Plan> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (sub?.plan) return sub.plan;
  const trial = await prisma.plan.findUnique({ where: { key: PlanKey.TRIAL } });
  if (!trial) throw new Error("TRIAL plan is not seeded");
  return trial;
}

/**
 * A `null` limit means unlimited: return without counting. Otherwise count the
 * current rows and throw once the org is already at (or over) the ceiling.
 */
async function assertUnder(
  limit: number | null,
  current: () => Promise<number>,
  label: string,
): Promise<void> {
  if (limit === null) return;
  const count = await current();
  if (count >= limit) {
    throw new PlanLimitError(`Your plan allows ${limit} ${label}. Upgrade to add more.`);
  }
}

export async function assertCanAddScreen(organizationId: string): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  await assertUnder(plan.maxScreens, () => prisma.screen.count({ where: { organizationId } }), "screens");
}

/**
 * Counts a seat for every ACTIVE membership AND every invitation still open
 * (not accepted, not expired).
 *
 * Counting memberships alone made the ceiling bypassable: an org at its cap
 * could issue N more invitations, and each `acceptInvite` would then create a
 * membership, because nothing re-checked at accept time. An open invitation is a
 * promised seat, so it is reserved here and released when it expires or is
 * accepted (at which point the membership it creates carries the seat).
 */
async function countReservedSeats(organizationId: string): Promise<number> {
  const [members, openInvites] = await Promise.all([
    prisma.membership.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.invitation.count({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  return members + openInvites;
}

export async function assertCanAddUser(organizationId: string): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  await assertUnder(plan.maxUsers, () => countReservedSeats(organizationId), "team members");
}

export async function assertCanAddLocation(organizationId: string): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  await assertUnder(
    plan.maxLocations,
    () => prisma.location.count({ where: { organizationId } }),
    "locations",
  );
}

/**
 * Storage consumed by an org against its plan ceiling. `usedBytes` sums the
 * `sizeBytes` of every non-archived asset that is READY or still UPLOADING; a
 * FAILED upload or an archived asset does not count. Stays in the bigint domain
 * end to end.
 */
export async function getStorageUsage(
  organizationId: string,
): Promise<{ usedBytes: bigint; limitBytes: bigint | null }> {
  const plan = await getPlanForOrg(organizationId);
  const agg = await prisma.mediaAsset.aggregate({
    _sum: { sizeBytes: true },
    where: { organizationId, archivedAt: null, status: { in: ["READY", "UPLOADING"] } },
  });
  // BigInt(0), not 0n: tsconfig target is ES2017 and rejects BigInt literals.
  return { usedBytes: agg._sum.sizeBytes ?? BigInt(0), limitBytes: plan.maxStorageBytes ?? null };
}

/**
 * Guard before accepting an upload of `addBytes`. A `null` plan ceiling means
 * unlimited and short-circuits before any query. Otherwise the org's current
 * usage plus the incoming bytes must not exceed the ceiling.
 */
export async function assertCanAddStorage(
  organizationId: string,
  addBytes: bigint,
): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  if (plan.maxStorageBytes == null) return;
  const { usedBytes } = await getStorageUsage(organizationId);
  if (usedBytes + addBytes > plan.maxStorageBytes) {
    throw new PlanLimitError(
      `Your plan includes ${formatBytes(plan.maxStorageBytes)} of storage. Free up space or upgrade to add more.`,
    );
  }
}

/**
 * Used-vs-limit numbers for every metered resource, for the dashboard and the
 * billing page. Users are counted as ACTIVE memberships only.
 */
export async function getUsageSummary(organizationId: string): Promise<{
  screens: { used: number; limit: number | null };
  users: { used: number; limit: number | null };
  locations: { used: number; limit: number | null };
  storage: { usedBytes: bigint; limitBytes: bigint | null };
}> {
  const plan = await getPlanForOrg(organizationId);
  const [screens, users, locations, storage] = await Promise.all([
    prisma.screen.count({ where: { organizationId } }),
    prisma.membership.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.location.count({ where: { organizationId } }),
    getStorageUsage(organizationId),
  ]);
  return {
    screens: { used: screens, limit: plan.maxScreens },
    users: { used: users, limit: plan.maxUsers },
    locations: { used: locations, limit: plan.maxLocations },
    storage,
  };
}
