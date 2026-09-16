import { Prisma } from "@prisma/client";

/**
 * The range and target every analytics read is scoped by. `from` is inclusive
 * and `to` is exclusive, matching the half-open day buckets `zeroFillByDay`
 * produces. `locationId` and `screenId` are independent optional narrowings;
 * when both are set the screen must sit in that location for a row to count.
 */
export type AnalyticsRange = {
  from: Date; // inclusive
  to: Date; // exclusive
  locationId?: string;
  screenId?: string;
};

/**
 * The Prisma `where` fragment shared by every `PlaybackEvent` read. RLS scopes
 * the organization on the connection, so this carries only the range and the
 * optional location / screen narrowings.
 */
export function playbackEventWhere(range: AnalyticsRange): Prisma.PlaybackEventWhereInput {
  return {
    airedAt: { gte: range.from, lt: range.to },
    ...(range.screenId ? { screenId: range.screenId } : {}),
    ...(range.locationId ? { screen: { locationId: range.locationId } } : {}),
  };
}

/**
 * The same range / location / screen filter as `playbackEventWhere`, expressed
 * for the raw-SQL reads that need `COUNT(DISTINCT ...)` and `date_trunc`.
 *
 * The first condition is an explicit `e."organizationId" = ${orgId}` predicate.
 * RLS still filters every row as a backstop, but its policy is an `OR` that
 * Postgres cannot use as an index condition, so without this bound predicate the
 * aggregate reads seq-scan the whole multi-tenant table. This scopes the org
 * explicitly and relies on RLS only as a second line of defence.
 *
 * `PlaybackEvent` is aliased `e` and `Screen` is aliased `s`; callers write
 * `FROM "PlaybackEvent" e ${joinLocation} WHERE ${whereSql}`. `joinLocation` is
 * `Prisma.empty` unless a location filter is set. Every dynamic value is a bound
 * parameter. This is the single raw-SQL expression of the filter, kept next to
 * the Prisma one so the two paths cannot drift.
 */
export function playbackEventRawFilter(
  orgId: string,
  range: AnalyticsRange,
): {
  joinLocation: Prisma.Sql;
  whereSql: Prisma.Sql;
} {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`e."organizationId" = ${orgId}`,
    Prisma.sql`e."airedAt" >= ${range.from}`,
    Prisma.sql`e."airedAt" < ${range.to}`,
  ];
  if (range.screenId) conditions.push(Prisma.sql`e."screenId" = ${range.screenId}`);
  const joinLocation = range.locationId
    ? Prisma.sql`JOIN "Screen" s ON s.id = e."screenId"`
    : Prisma.empty;
  if (range.locationId) conditions.push(Prisma.sql`s."locationId" = ${range.locationId}`);

  return { joinLocation, whereSql: Prisma.join(conditions, " AND ") };
}
