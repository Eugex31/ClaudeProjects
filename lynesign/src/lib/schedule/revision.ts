import type { TenantTransactionClient } from "@/lib/db/tenant";

/**
 * Bump a schedule rule's `revision` by one inside an existing tenant transaction.
 *
 * `revision` is the version a screen compares against its cached copy to know
 * the copy is stale. Call this from the same `withOrgTransaction` that made the
 * content or targeting change, so the write and the bump commit together.
 */
export async function bumpScheduleRevision(
  tx: TenantTransactionClient,
  id: string,
): Promise<void> {
  await tx.scheduleRule.update({
    where: { id },
    data: { revision: { increment: 1 } },
  });
}
