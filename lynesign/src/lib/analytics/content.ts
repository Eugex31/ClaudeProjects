import { withOrgTransaction } from "@/lib/db/tenant";

import { zeroFillByDay } from "./shape";
import { playbackEventRawFilter, type AnalyticsRange } from "./types";

export type ContentRow = {
  mediaAssetId: string; // "" for the collapsed null-asset row
  assetName: string; // asset name, or "Unattributed" for the null-asset row
  kind: string | null; // MediaAsset.kind, null for the "Unattributed" row
  plays: number;
  playSeconds: number;
  screensReached: number; // COUNT(DISTINCT screenId)
  lastAiredAt: string; // ISO
};

type GroupRow = {
  mediaAssetId: string | null;
  plays: bigint | number | string;
  play_seconds: bigint | number | string | null;
  screens_reached: bigint | number | string;
  last_aired_at: Date;
};

type DayRow = { d: string; plays: bigint | number | string };

/**
 * Per-asset playback rollup plus a zero-filled per-day play count.
 *
 * One `withOrgTransaction`: a `GROUP BY "mediaAssetId"` raw query does the
 * aggregation, then one `mediaAsset.findMany` resolves names and kinds. Rows
 * with a null `mediaAssetId` collapse into a single "Unattributed" row. `byDay`
 * buckets `airedAt` by UTC day and is zero-filled across the whole range.
 * `"Screen"` is joined only when a location filter is set; every dynamic value
 * is a bound parameter.
 */
export async function getContentPerformance(
  orgId: string,
  range: AnalyticsRange,
): Promise<{ rows: ContentRow[]; byDay: Array<{ date: string; plays: number }> }> {
  return withOrgTransaction(orgId, async (tx) => {
    const { joinLocation, whereSql } = playbackEventRawFilter(orgId, range);

    const grouped = await tx.$queryRaw<GroupRow[]>`
      SELECT
        e."mediaAssetId" AS "mediaAssetId",
        count(*) AS plays,
        sum(e."durationSeconds") AS play_seconds,
        count(DISTINCT e."screenId") AS screens_reached,
        max(e."airedAt") AS last_aired_at
      FROM "PlaybackEvent" e
      ${joinLocation}
      WHERE ${whereSql}
      GROUP BY e."mediaAssetId"
    `;

    const nonNullIds = grouped
      .map((g) => g.mediaAssetId)
      .filter((id): id is string => id !== null);

    const assets = nonNullIds.length
      ? await tx.mediaAsset.findMany({
          where: { id: { in: nonNullIds } },
          select: { id: true, name: true, kind: true },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const rows: ContentRow[] = grouped.map((g) => {
      const base = {
        plays: Number(g.plays),
        playSeconds: Number(g.play_seconds ?? 0),
        screensReached: Number(g.screens_reached),
        lastAiredAt: g.last_aired_at.toISOString(),
      };
      if (g.mediaAssetId === null) {
        return { mediaAssetId: "", assetName: "Unattributed", kind: null, ...base };
      }
      const asset = assetById.get(g.mediaAssetId);
      return {
        mediaAssetId: g.mediaAssetId,
        assetName: asset?.name ?? "",
        kind: asset ? String(asset.kind) : null,
        ...base,
      };
    });

    rows.sort((a, b) => b.plays - a.plays || a.assetName.localeCompare(b.assetName));

    const dayRows = await tx.$queryRaw<DayRow[]>`
      SELECT
        to_char(date_trunc('day', e."airedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d,
        count(*) AS plays
      FROM "PlaybackEvent" e
      ${joinLocation}
      WHERE ${whereSql}
      GROUP BY d
    `;
    const byDay = zeroFillByDay(
      dayRows.map((r) => ({ date: r.d, plays: Number(r.plays) })),
      range.from,
      range.to,
    );

    return { rows, byDay };
  });
}
