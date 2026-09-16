import type { TenantTransactionClient } from "@/lib/db/tenant";

/**
 * Bump a canvas's `revision` by one inside an existing tenant transaction.
 *
 * `revision` is the manifest-structure version: a screen compares it against its
 * cached copy to know the copy is stale. Call this from the same
 * `withOrgTransaction` that made the layout or content change, so the write and
 * the bump commit together.
 */
export async function bumpCanvasRevision(
  tx: TenantTransactionClient,
  canvasId: string,
): Promise<void> {
  await tx.canvas.update({
    where: { id: canvasId },
    data: { revision: { increment: 1 } },
  });
}
