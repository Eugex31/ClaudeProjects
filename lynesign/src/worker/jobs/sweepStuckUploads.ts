import { prisma } from "@/lib/db/root";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logging";
import { storage, assetPrefix } from "@/lib/storage";

const STUCK_AFTER_MS = 60 * 60 * 1000;

/**
 * Fails media uploads that never finalized. A row left `UPLOADING` for more than
 * an hour is abandoned: the browser closed, the PUT failed, `finalizeUpload` was
 * never called. For each one the stored prefix is cleared (the presigned PUT may
 * have written bytes) and the row is flipped to `FAILED`. Runs unscoped across
 * every organization; one aggregate SYSTEM audit row is written per org.
 */
export async function sweepStuckUploads(
  now: Date = new Date(),
): Promise<{ failed: number }> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);

  const stuck = await prisma.mediaAsset.findMany({
    where: { status: "UPLOADING", createdAt: { lt: cutoff } },
    select: { id: true, organizationId: true },
    take: 200,
  });

  if (stuck.length === 0) {
    return { failed: 0 };
  }

  const perOrg = new Map<string, number>();
  for (const asset of stuck) {
    await storage.deletePrefix(assetPrefix(asset.organizationId, asset.id));
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED" },
    });
    perOrg.set(asset.organizationId, (perOrg.get(asset.organizationId) ?? 0) + 1);
  }

  for (const [organizationId, count] of perOrg) {
    await writeAudit({
      organizationId,
      actorType: "SYSTEM",
      action: "media.upload.expired",
      targetType: "MediaAsset",
      metadata: { count },
    });
  }

  logger.info({ failed: stuck.length, orgs: perOrg.size }, "swept stuck media uploads");
  return { failed: stuck.length };
}
