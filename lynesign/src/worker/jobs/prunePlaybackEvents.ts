import { prisma } from "@/lib/db/root";
import { logger } from "@/lib/logging";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Primary keys deleted per batch. Exported so a test can drive the batching
 * loop with a small fixture without seeding tens of thousands of rows.
 */
export const PRUNE_BATCH = 5000;

/**
 * Hard ceiling on batches per tick. A very large backlog is drained over
 * several ticks rather than in one unbounded pass, so a single call can never
 * hold a long transaction or a large result set.
 */
const MAX_BATCHES_PER_TICK = 20;

/**
 * Hard-deletes `PlaybackEvent` rows whose `airedAt` is older than the 90 day
 * retention window. Proof-of-play history ages out on the same schedule for
 * every tenant, so this runs unscoped across every organization. No audit row
 * is written: a periodic retention delete is not an organization action.
 *
 * The delete is batched by primary key, mirroring `purgeArchivedMedia`: each
 * pass selects up to `batchSize` keys older than the cutoff and deletes exactly
 * those rows. It stops when a pass finds fewer than `batchSize` rows or after
 * `MAX_BATCHES_PER_TICK` passes, and the next scheduled run continues from
 * there. Returns the total deleted; logs only when that is greater than zero.
 */
export async function prunePlaybackEvents(
  now: Date = new Date(),
  batchSize: number = PRUNE_BATCH,
): Promise<{ pruned: number }> {
  const cutoff = new Date(now.getTime() - RETENTION_MS);

  let totalDeleted = 0;
  for (let pass = 0; pass < MAX_BATCHES_PER_TICK; pass += 1) {
    const stale = await prisma.playbackEvent.findMany({
      where: { airedAt: { lt: cutoff } },
      select: { organizationId: true, id: true },
      take: batchSize,
    });
    if (stale.length === 0) {
      break;
    }

    const deleted = await prisma.playbackEvent.deleteMany({
      where: {
        OR: stale.map((r) => ({ organizationId: r.organizationId, id: r.id })),
      },
    });
    totalDeleted += deleted.count;

    if (stale.length < batchSize) {
      break;
    }
  }

  if (totalDeleted > 0) {
    logger.info({ pruned: totalDeleted }, "pruned playback events");
  }

  return { pruned: totalDeleted };
}
