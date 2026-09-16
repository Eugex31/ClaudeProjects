import type { TenantTransactionClient } from "@/lib/db/tenant";

/**
 * Bump a campaign's `revision` by one inside an existing tenant transaction.
 *
 * `revision` is the version a screen compares against its cached copy to know
 * the copy is stale. Call this from the same `withOrgTransaction` that made the
 * content or targeting change, so the write and the bump commit together.
 */
export async function bumpCampaignRevision(
  tx: TenantTransactionClient,
  campaignId: string,
): Promise<void> {
  await tx.campaign.update({
    where: { id: campaignId },
    data: { revision: { increment: 1 } },
  });
}
