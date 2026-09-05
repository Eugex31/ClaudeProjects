import { Prisma } from "@prisma/client";

import { withOrgTransaction, type TenantTransactionClient } from "@/lib/db/tenant";

import { playbackEventRawFilter, type AnalyticsRange } from "./types";

export type ProofRow = {
  id: string;
  name: string;
  airings: number;
  playSeconds: number;
  screensReached: number; // COUNT(DISTINCT screenId)
  locationsReached: number; // COUNT(DISTINCT the location of those screens)
  firstAiredAt: string; // ISO
  lastAiredAt: string; // ISO
};

type GroupRow = {
  group_id: string;
  airings: bigint | number | string;
  play_seconds: bigint | number | string | null;
  screens_reached: bigint | number | string;
  locations_reached: bigint | number | string;
  first_aired: Date;
  last_aired: Date;
};

/**
 * Shared body of both proof-of-play reports. Groups `PlaybackEvent` by one of
 * its two rule columns, then resolves the surviving entity names.
 *
 * `"Screen"` is always joined so `locations_reached` has a column to count and
 * so an optional location filter has its `s` alias. That makes
 * `playbackEventRawFilter`'s own `joinLocation` redundant here; only its
 * `whereSql` is used, carrying the `airedAt` bounds plus any `screenId` /
 * `locationId` narrowing. `${groupColumn}` is a fixed identifier fragment, never
 * caller input. A group whose id no longer resolves to a row (the rule was
 * deleted since the events were recorded) is dropped: proof-of-play is about
 * entities that still exist to be proven.
 */
async function proofOfPlay(
  tx: TenantTransactionClient,
  orgId: string,
  range: AnalyticsRange,
  groupColumn: Prisma.Sql,
  resolveNames: (ids: string[]) => Promise<Array<{ id: string; name: string | null }>>,
): Promise<ProofRow[]> {
  const { whereSql } = playbackEventRawFilter(orgId, range);

  const grouped = await tx.$queryRaw<GroupRow[]>`
    SELECT
      ${groupColumn} AS group_id,
      count(*) AS airings,
      sum(e."durationSeconds") AS play_seconds,
      count(DISTINCT e."screenId") AS screens_reached,
      count(DISTINCT s."locationId") AS locations_reached,
      min(e."airedAt") AS first_aired,
      max(e."airedAt") AS last_aired
    FROM "PlaybackEvent" e
    JOIN "Screen" s ON s.id = e."screenId"
    WHERE ${whereSql} AND ${groupColumn} IS NOT NULL
    GROUP BY ${groupColumn}
  `;

  const groupIds = grouped.map((g) => g.group_id);
  const named = groupIds.length ? await resolveNames(groupIds) : [];
  const nameById = new Map(named.map((n) => [n.id, n.name ?? ""]));

  const rows: ProofRow[] = [];
  for (const g of grouped) {
    const name = nameById.get(g.group_id);
    if (name === undefined) continue; // rule deleted since its events were recorded
    rows.push({
      id: g.group_id,
      name,
      airings: Number(g.airings),
      playSeconds: Number(g.play_seconds ?? 0),
      screensReached: Number(g.screens_reached),
      locationsReached: Number(g.locations_reached),
      firstAiredAt: g.first_aired.toISOString(),
      lastAiredAt: g.last_aired.toISOString(),
    });
  }

  rows.sort((a, b) => b.airings - a.airings || a.name.localeCompare(b.name));
  return rows;
}

/**
 * Per-campaign proof that a campaign actually aired: airings, seconds on glass,
 * distinct screens and locations reached, and the first and last airing. One
 * `withOrgTransaction`; one grouped raw query joined to `Campaign` for names.
 * Rows for a campaign that has since been deleted are dropped. Ordered by
 * airings desc, then name asc.
 */
export async function getCampaignProofOfPlay(
  orgId: string,
  range: AnalyticsRange,
): Promise<ProofRow[]> {
  return withOrgTransaction(orgId, (tx) =>
    proofOfPlay(tx, orgId, range, Prisma.sql`e."campaignId"`, (ids) =>
      tx.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ),
  );
}

/**
 * Per-schedule-rule counterpart of `getCampaignProofOfPlay`, grouping on
 * `scheduleRuleId` and resolving names from `ScheduleRule`. Same shape, same
 * ordering, same drop of rules that no longer exist.
 */
export async function getScheduleProofOfPlay(
  orgId: string,
  range: AnalyticsRange,
): Promise<ProofRow[]> {
  return withOrgTransaction(orgId, (tx) =>
    proofOfPlay(tx, orgId, range, Prisma.sql`e."scheduleRuleId"`, (ids) =>
      tx.scheduleRule.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ),
  );
}
