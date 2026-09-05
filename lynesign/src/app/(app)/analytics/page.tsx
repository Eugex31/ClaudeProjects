import { requireRole } from "@/lib/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { StatTile } from "@/components/app/stat-tile";
import { AnalyticsFilters } from "@/components/app/analytics/analytics-filters";
import { PlaysByDayChart } from "@/components/app/analytics/plays-by-day-chart";
import { ContentPerformanceTable } from "@/components/app/analytics/content-performance-table";
import { ProofOfPlayTable } from "@/components/app/analytics/proof-of-play-table";
import { getPlaybackSummary } from "@/lib/analytics/summary";
import { getContentPerformance } from "@/lib/analytics/content";
import {
  getCampaignProofOfPlay,
  getScheduleProofOfPlay,
} from "@/lib/analytics/proof-of-play";
import type { AnalyticsRange } from "@/lib/analytics/types";

export const metadata = { title: "Analytics" };

const DAY_MS = 86_400_000;

/**
 * Start of tomorrow in UTC: today's UTC midnight plus one day. This is the
 * default exclusive upper bound of the range, so the last full day today is
 * always included.
 */
function startOfTomorrowUtc(): Date {
  const now = new Date();
  const todayMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(todayMidnight + DAY_MS);
}

/**
 * Parse a strict `"YYYY-MM-DD"` search param into a UTC-midnight `Date`, or
 * `null` when the value is absent, malformed, or not a real date.
 */
function parseYmd(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (Number.isNaN(Date.parse(value))) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Analytics (proof-of-play) for the active organization. `requireRole` gates on
 * `analytics.view` and scopes `ctx.db` and `ctx.organizationId`. The range comes
 * from `?from` / `?to` (inclusive end day, so the exclusive bound is that day
 * plus one), each falling back to a rolling 30-day default, with `?location` /
 * `?screen` as optional narrowings. The four report reads run together, then the
 * summary tiles, the plays-by-day chart, and the content and proof-of-play
 * tables render from the results. When nothing played in the range only an
 * empty-state line shows. Only strings, numbers, and plain objects cross into
 * the client components; the report functions already return ISO strings for
 * every date, so no `Date` reaches a client component.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string | string[];
    to?: string | string[];
    location?: string | string[];
    screen?: string | string[];
  }>;
}) {
  const ctx = await requireRole("analytics.view");
  const params = await searchParams;

  // A repeated query key (`?location=a&location=b`) arrives as `string[]` at
  // runtime; take the first value so every downstream read is a plain string.
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const fromParam = one(params.from);
  const toParam = one(params.to);
  const locationParam = one(params.location);
  const screenParam = one(params.screen);

  const defaultTo = startOfTomorrowUtc();
  const defaultFrom = new Date(defaultTo.getTime() - 30 * DAY_MS);

  const parsedFrom = parseYmd(fromParam);
  const parsedTo = parseYmd(toParam);

  let from = parsedFrom ?? defaultFrom;
  let to = parsedTo ? new Date(parsedTo.getTime() + DAY_MS) : defaultTo;

  if (from.getTime() >= to.getTime()) {
    from = defaultFrom;
    to = defaultTo;
  }

  const MAX_SPAN_MS = 400 * DAY_MS; // 90-day retention plus headroom
  if (to.getTime() - from.getTime() > MAX_SPAN_MS) {
    from = new Date(to.getTime() - MAX_SPAN_MS);
  }

  const [screens, locations] = await Promise.all([
    ctx.db.screen.findMany({
      select: {
        id: true,
        name: true,
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ location: { name: "asc" } }, { name: "asc" }],
    }),
    ctx.db.location.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const range: AnalyticsRange = {
    from,
    to,
    locationId: locationParam || undefined,
    screenId: screenParam || undefined,
  };

  const [summary, content, campaigns, schedule] = await Promise.all([
    getPlaybackSummary(ctx.organizationId, range),
    getContentPerformance(ctx.organizationId, range),
    getCampaignProofOfPlay(ctx.organizationId, range),
    getScheduleProofOfPlay(ctx.organizationId, range),
  ]);

  const fromYMD = range.from.toISOString().slice(0, 10);
  const toParamYMD = new Date(range.to.getTime() - DAY_MS)
    .toISOString()
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Playback reported by your paired screens."
      />

      <AnalyticsFilters
        from={fromYMD}
        to={toParamYMD}
        screens={screens}
        locations={locations}
        selectedLocation={locationParam}
        selectedScreen={screenParam}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total plays" value={summary.totalPlays} />
        <StatTile
          label="Play hours"
          value={(summary.totalPlaySeconds / 3600).toFixed(1)}
        />
        <StatTile
          label="Screens reporting"
          value={`${summary.reportingScreens} of ${screens.length}`}
        />
        <StatTile label="Distinct assets" value={summary.distinctAssets} />
      </div>

      {summary.totalPlays === 0 ? (
        <p className="text-sm text-body">
          No playback reported for this range. Paired players report airings once
          they are running.
        </p>
      ) : (
        <div className="space-y-8">
          <PlaysByDayChart byDay={content.byDay} />

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-ink">Content performance</h2>
            <ContentPerformanceTable rows={content.rows} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-ink">Proof of play</h2>
            <ProofOfPlayTable
              title="Campaigns"
              kind="campaign"
              rows={campaigns}
            />
            <ProofOfPlayTable
              title="Schedule rules"
              kind="schedule"
              rows={schedule}
            />
          </section>
        </div>
      )}
    </div>
  );
}
