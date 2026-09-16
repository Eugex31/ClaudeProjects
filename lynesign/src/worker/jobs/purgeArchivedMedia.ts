import { prisma } from "@/lib/db/root";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logging";
import { storage, assetPrefix } from "@/lib/storage";

const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hard-deletes media that has been archived for more than a week. An asset is
 * only purged when nothing still points at it: no `Picture`, no `Video`, and no
 * `PlaylistItem` row carries its id. When it is safe, the stored prefix is
 * removed and the row is deleted. An asset still referenced by content is left
 * in place for the next run. Runs unscoped across every organization; one
 * aggregate SYSTEM audit row is written per org.
 */
export async function purgeArchivedMedia(
  now: Date = new Date(),
): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);

  const stale = await prisma.mediaAsset.findMany({
    where: { archivedAt: { lt: cutoff } },
    select: { id: true, organizationId: true },
    take: 200,
  });

  if (stale.length === 0) {
    await sweepDoneJobs(now);
    return { purged: 0 };
  }

  const perOrg = new Map<string, number>();
  for (const asset of stale) {
    const refs =
      (await prisma.picture.count({ where: { mediaAssetId: asset.id } })) +
      (await prisma.video.count({ where: { mediaAssetId: asset.id } })) +
      (await prisma.playlistItem.count({ where: { mediaAssetId: asset.id } }));
    if (refs !== 0) continue;

    await storage.deletePrefix(assetPrefix(asset.organizationId, asset.id));
    await prisma.mediaProcessingJob.deleteMany({ where: { mediaAssetId: asset.id } });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    perOrg.set(asset.organizationId, (perOrg.get(asset.organizationId) ?? 0) + 1);
  }

  let purged = 0;
  for (const [organizationId, count] of perOrg) {
    purged += count;
    await writeAudit({
      organizationId,
      actorType: "SYSTEM",
      action: "media.purged",
      targetType: "MediaAsset",
      metadata: { count },
    });
  }

  await sweepDoneJobs(now);

  logger.info({ purged, orgs: perOrg.size }, "purged archived media");
  return { purged };
}

/**
 * Retention sweep for the global processing queue: drop `DONE` job rows older
 * than a week. They carry no organization and nothing reads them once done, so
 * they only accumulate.
 */
async function sweepDoneJobs(now: Date): Promise<void> {
  await prisma.mediaProcessingJob.deleteMany({
    where: {
      status: "DONE",
      updatedAt: { lt: new Date(now.getTime() - JOB_RETENTION_MS) },
    },
  });
}
