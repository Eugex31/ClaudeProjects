import type { TenantTransactionClient } from "@/lib/db/tenant";

/**
 * Bump a playlist's `revision` by one inside an existing tenant transaction.
 *
 * `revision` is the manifest-structure version: a screen compares it against its
 * cached copy to know the copy is stale. Call this from the same
 * `withOrgTransaction` that made the content or setting change, so the write and
 * the bump commit together.
 */
export async function bumpRevision(
  tx: TenantTransactionClient,
  playlistId: string,
): Promise<void> {
  await tx.playlist.update({
    where: { id: playlistId },
    data: { revision: { increment: 1 } },
  });
}
