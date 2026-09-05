import { withOrgTransaction } from "@/lib/db/tenant";

import { playbackEventRawFilter, playbackEventWhere, type AnalyticsRange } from "./types";

/**
 * Four scalar totals over `PlaybackEvent` for the analytics summary tiles.
 *
 * All reads run inside one `withOrgTransaction`, so guard layer 1 and the
 * Postgres RLS GUC both scope the organization. The two simple aggregates go
 * through Prisma; `reportingScreens` and `distinctAssets` need `COUNT(DISTINCT
 * ...)`, which Prisma cannot express, so they come from one parameterized raw
 * query on the same transaction. `"Screen"` is joined only when a location
 * filter is set.
 */
export async function getPlaybackSummary(
  orgId: string,
  range: AnalyticsRange,
): Promise<{
  totalPlays: number;
  totalPlaySeconds: number;
  reportingScreens: number;
  distinctAssets: number;
}> {
  return withOrgTransaction(orgId, async (tx) => {
    const where = playbackEventWhere(range);

    const totalPlays = await tx.playbackEvent.count({ where });
    const durationSum = await tx.playbackEvent.aggregate({
      where,
      _sum: { durationSeconds: true },
    });
    const totalPlaySeconds = durationSum._sum.durationSeconds ?? 0;

    const { joinLocation, whereSql } = playbackEventRawFilter(orgId, range);

    const distinctRows = await tx.$queryRaw<
      Array<{ reporting_screens: bigint | number | string; distinct_assets: bigint | number | string }>
    >`
      SELECT
        count(DISTINCT e."screenId") AS reporting_screens,
        count(DISTINCT e."mediaAssetId") AS distinct_assets
      FROM "PlaybackEvent" e
      ${joinLocation}
      WHERE ${whereSql}
    `;

    return {
      totalPlays,
      totalPlaySeconds,
      reportingScreens: Number(distinctRows[0]?.reporting_screens ?? 0),
      distinctAssets: Number(distinctRows[0]?.distinct_assets ?? 0),
    };
  });
}
