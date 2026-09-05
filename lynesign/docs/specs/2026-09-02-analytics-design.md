# Analytics (Proof-of-Play) - Design Spec

**Increment:** 8 of the LyneSign rebuild (1 Foundation, 3 Media Library, 4 Playlists + preview, 6 Campaigns, 7 Schedule, then this; 2 Player runtime and 5 Visual canvas editor were planned but not built).
**Status:** approved for planning.
**Date:** 2026-09-02.

Paired players report the content they actually displayed. The server stores one
row per airing in a tenant-scoped `PlaybackEvent` table. The `/analytics` page
aggregates those rows on read into three views: summary tiles, content
performance, and campaign / schedule proof-of-play. A worker task prunes raw
events older than 90 days. This increment delivers the ingest endpoint, the
model, the reporting functions, the page, the prune task, and a demo data
script. It does not deliver rollup tables, materialized views, per-screen
drill-down pages, real-time streaming, CSV export, or scheduled email reports.

---

## 1. Context

### What exists today that this builds on

- **The player API** is device-authed: `authenticateDevice(req)`
  (`src/lib/player/device-auth.ts`) resolves a `Screen` from a bearer token.
  `GET /api/player/sync` returns the manifest with a `source` of
  `"campaign" | "schedule" | "playlist" | "none"` plus `campaign` / `schedule`
  identity objects. `POST /api/player/heartbeat` bumps `Screen.lastSeenAt` and
  holds `status` at `ONLINE`. Both routes use the root `prisma` client and are in
  the ESLint `RAW_PRISMA_ALLOWED` allow-list (`src/app/api/player/**`); every
  read in them is explicitly scoped with `organizationId: screen.organizationId`.
- **`resolveScreenContent`** (`src/lib/player/campaign.ts`, pure) already returns
  the resolved `source` and the ids the player needs; the demo script reuses it.
- **`AuditLog`** is the only event-like table today. `simulate-content.ts` writes
  `AuditLog` rows as an analytics stand-in. `getDashboardData`
  (`src/lib/dashboard.ts`) reads the last 10 for the recent-activity feed and
  derives live screen online/offline counts from `lastSeenAt`.
- **Two-layer tenant isolation.** The Prisma `$extends` facade (`forOrg(orgId)` /
  `withOrgTransaction`, `src/lib/db/tenant.ts`) injects `organizationId` and fails
  closed; Postgres `FORCE ROW LEVEL SECURITY` with predicate
  `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`
  (USING + WITH CHECK). The tenant-table list is triplicated and guarded: each
  feature migration `ARRAY`, `TENANT_MODELS` (`src/lib/db/tenant.ts`, camelCase),
  `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`, PascalCase);
  `src/lib/db/tenant-model-list.test.ts` asserts all three agree by set equality.
  Today: 33 tenant tables. This increment adds 1 -> 34.
- **RBAC** (`src/lib/rbac/policy.ts`): an `Action` string union plus
  `POLICY: Record<Action, Role[]>`. Groups: `ALL` (includes `VIEWER`),
  `CONTENT_UP`, `MANAGERS_UP`, `ADMINS_UP`. `requireRole(action)`
  (`src/lib/auth/context.ts`) returns `ctx = { user, organizationId, role, db, actor }`.
  `can(actor, action)` is the predicate form used in pages.
- **The worker** (`src/worker/index.ts` + `src/worker/jobs/*.ts`): each job is a
  module exporting one async function; `index.ts` runs it on a fixed interval
  behind a boolean re-entrancy guard and a try/catch that logs. `purgeArchivedMedia`
  (900s interval) is the closest sibling: it runs unscoped across all orgs,
  `take`-limits its batch, and writes one aggregate `SYSTEM` audit row per org.
- **Nav** (`src/lib/nav.ts`) has `{ href: "/analytics", label: "Analytics", ... }`
  with no `action`; the page is a `ComingSoon` placeholder at
  `src/app/(app)/analytics/page.tsx`.
- **No chart library and no date-picker library** are installed. Charts are
  hand-rolled inline SVG. Date entry is `<input type="date">`.
- **Server action / route pattern**: `requireRole` first, `safeParse` (zod),
  work through the facade / scoped reads, `writeAudit` for mutations,
  `revalidatePath`. Device routes skip `requireRole` (they use
  `authenticateDevice` instead) and never write audit rows for ingest.

---

## 2. Scope

### In scope

1. `PlaybackEvent` model, one migration, RLS, facade + triplicated-list updates
   (-> 34), one DB CHECK.
2. `POST /api/player/events` - device-authed batch ingest, idempotent by
   client-supplied id.
3. `src/lib/validation/analytics.ts` - the ingest batch zod schema.
4. `src/lib/analytics/` - `getPlaybackSummary`, `getContentPerformance`,
   `getCampaignProofOfPlay`, `getScheduleProofOfPlay`, and the pure
   shaping helpers they use.
5. `analytics.view` RBAC action (group `ALL`) and the nav gate.
6. `/analytics` page: summary tiles, a shared date-range + location/screen
   filter bar, the content-performance table + plays-by-day chart, the two
   proof-of-play tables.
7. `src/worker/jobs/prunePlaybackEvents.ts` + wiring in `src/worker/index.ts`.
8. `scripts/simulate-analytics.ts` - demo playback events consistent with the
   seeded playlists / campaigns / schedule.
9. Tests: pure helpers, ingest integration, reporting functions, RBAC + nav,
   tenant isolation (incl. a device from org B posting for an org A screen),
   worker prune, e2e.
10. `docs/architecture.md` section + roadmap update.

### Out of scope (later or never)

- Rollup / summary tables and materialized views (compute-on-read only this
  increment; revisit when the raw table passes low tens of millions of rows).
- A dedicated per-screen analytics page (screen filtering on the content report
  covers the need).
- CSV / PDF export, scheduled email reports, a public advertiser-facing report
  link.
- Real-time / streaming updates; the page is request-time only.
- Backfilling historical data from `AuditLog` (there is no real playback history
  to recover).
- Any change to what `GET /api/player/sync` returns.

---

## 3. Architecture

### 3.1 Ingest flow

1. A paired player accumulates airings locally and periodically
   `POST /api/player/events` with a JSON batch.
2. `authenticateDevice(req)` resolves the `Screen` (401 on a bad / missing
   token, same problem shape as sync).
3. The batch is `safeParse`d. A malformed batch is a 422 problem. A batch over
   the size cap is a 413 problem.
4. Every event's `screenId` must equal the authenticated screen's id. A batch
   containing any other screen id is rejected whole (400 problem) - a device may
   only report its own airings.
5. `mediaAssetId` / `playlistId` / `campaignId` / `scheduleRuleId` are resolved
   against the authenticated screen's org. An id that does not resolve is stored
   as `null` (the device cache can lag a delete); the event is still inserted.
6. Rows are inserted with `prisma.playbackEvent.createMany({ data, skipDuplicates: true })`.
   The primary key is the composite `(organizationId, id)` over the client-supplied
   `id`, so a retried batch inserts zero new rows and a collision cannot cross
   tenants. The response is
   `{ accepted: <rows created>, duplicates: <events kept minus accepted>, dropped: <events outside the airedAt window> }`
   (spec section 5).
7. No audit row is written for ingest (it would dwarf the audit log). Ingest
   failures at 500 are logged with the request id, like sync.

### 3.2 `PlaybackEvent` - data model (spec section 4)

One row per airing. The device owns `id` and `airedAt`; the server owns
`receivedAt` and the null-coalescing of unresolved ids.

### 3.3 Reporting - `src/lib/analytics/`

Every function signature is
`(db: TenantClient, range: AnalyticsRange) => Promise<...>` where

```ts
type AnalyticsRange = {
  from: Date;          // inclusive, start of day in the org's frame is the caller's job
  to: Date;            // exclusive
  locationId?: string; // filter: events on screens in this location
  screenId?: string;   // filter: events on this screen
};
```

`db` is the tenant facade (`ctx.db`), so `organizationId` is injected and RLS is
active. `locationId` filters via `screen: { locationId }` on the relation;
`screenId` filters directly. The two filters are independent and both optional.

- **`getPlaybackSummary(db, range)`** ->
  `{ totalPlays: number; totalPlaySeconds: number; reportingScreens: number; distinctAssets: number }`.
  `reportingScreens` = `COUNT(DISTINCT screenId)` with an event in range - the
  honest denominator for "screens actually sending data". `distinctAssets` =
  `COUNT(DISTINCT mediaAssetId)` where non-null.

- **`getContentPerformance(db, range)`** ->
  ```ts
  {
    rows: Array<{
      mediaAssetId: string;       // "" for the collapsed null-asset row
      assetName: string;          // the asset's current name, or "Unattributed" for the null-asset row
      kind: MediaKind | null;     // null for the "Unattributed" row
      plays: number;
      playSeconds: number;
      screensReached: number;     // COUNT(DISTINCT screenId)
      lastAiredAt: string;        // ISO
    }>;
    byDay: Array<{ date: string; plays: number }>;  // "YYYY-MM-DD", one entry per day in [from, to), zero-filled
  }
  ```
  Rows with `mediaAssetId = null` collapse into a single `"Unattributed"` row
  (id `""`). `byDay` bucketing uses `date_trunc('day', "airedAt")` at UTC;
  the zero-fill and the ISO date strings are produced by a pure helper
  `zeroFillByDay(rows, from, to)` so it is unit-testable without a DB.

- **`getCampaignProofOfPlay(db, range)`** and
  **`getScheduleProofOfPlay(db, range)`** -> `Array<{ id: string; name: string;
  airings: number; playSeconds: number; screensReached: number;
  locationsReached: number; firstAiredAt: string; lastAiredAt: string }>`,
  ordered by `airings` desc. `locationsReached` = distinct location of the
  screens that aired it. A campaign / rule that has been deleted since the events
  were recorded (FK now null) is dropped from these reports - proof-of-play is
  about entities that still exist to be proven.

Aggregations use Prisma `groupBy` where the shape allows and `db.$queryRaw`
(through the facade's `$queryRaw` passthrough, inside `withOrgTransaction` when
raw) for the `COUNT(DISTINCT ...)` and `date_trunc` cases Prisma cannot express.
Every raw query is parameterized; no string interpolation of caller input.

### 3.4 Retention - `src/worker/jobs/prunePlaybackEvents.ts`

```ts
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function prunePlaybackEvents(now: Date = new Date()): Promise<{ pruned: number }>;
```

Runs unscoped across all orgs (like `purgeArchivedMedia`):
`prisma.playbackEvent.deleteMany({ where: { airedAt: { lt: new Date(now - RETENTION_MS) } } })`,
returns `{ pruned }`, logs the count when `> 0`. No audit row (a periodic
retention delete is not an org action). Wired into `src/worker/index.ts` with its
own interval constant (`PRUNE_PLAYBACK_INTERVAL_MS = 3_600_000`), its own
re-entrancy guard flag, and a `runPrunePlayback()` wrapper matching the existing
`runPurgeArchived()` shape.

### 3.5 No new dependencies

`Intl` and `<input type="date">` cover date handling. Charts are inline SVG
(`<rect>` bars keyed off a computed max). No chart / date library.

---

## 4. Data model - `PlaybackEvent`

| column | type | notes |
| --- | --- | --- |
| `id` | `String` | **client-supplied** (device event id). No `@default`. The idempotency key. Part of the composite primary key `@@id([organizationId, id])`, so the identity is tenant-local. |
| `organizationId` | `String` | FK -> `Organization`, `onDelete: Cascade` |
| `screenId` | `String` | FK -> `Screen`, `onDelete: Cascade` |
| `mediaAssetId` | `String?` | FK -> `MediaAsset`, `onDelete: SetNull` |
| `playlistId` | `String?` | FK -> `Playlist`, `onDelete: SetNull` |
| `source` | `String` | `"playlist" \| "campaign" \| "schedule"` (validated in zod, not a DB enum - keeps the migration simple and matches how `Campaign`/sync already treat `source`) |
| `campaignId` | `String?` | FK -> `Campaign`, `onDelete: SetNull` |
| `scheduleRuleId` | `String?` | FK -> `ScheduleRule`, `onDelete: SetNull` |
| `airedAt` | `DateTime @db.Timestamptz(3)` | airing start, device clock |
| `durationSeconds` | `Int` | DB CHECK `playback_event_duration_nonneg`: `"durationSeconds" >= 0 AND "durationSeconds" <= 86400` |
| `receivedAt` | `DateTime @default(now()) @db.Timestamptz(3)` | server receipt |

Indexes:
- `@@index([organizationId, airedAt])`
- `@@index([organizationId, mediaAssetId, airedAt])`
- `@@index([organizationId, campaignId, airedAt])`
- `@@index([organizationId, scheduleRuleId, airedAt])`
- `@@index([screenId, airedAt])`

Relations / back-relations: `organization`, `screen`, `mediaAsset MediaAsset?`,
`playlist Playlist?`, `campaign Campaign?`, `scheduleRule ScheduleRule?`. Add the
matching back-relation array fields to `Organization`, `Screen`, `MediaAsset`,
`Playlist`, `Campaign`, `ScheduleRule`.

RLS: hand-appended `DO $$ ... FOREACH t IN ARRAY ARRAY['PlaybackEvent'] ...`
block, predicate byte-identical to `20260830032500_rls_empty_guc_is_unscoped`.
The CHECK constraint is added in the same migration after the generated DDL.

`TENANT_MODELS` gains `"playbackEvent"`; `TENANT_TABLES` gains `"PlaybackEvent"`;
`tenant-model-list.test.ts` stays green by set equality (no count literal).

---

## 5. Ingest validation - `src/lib/validation/analytics.ts`

```ts
export const playbackEventSchema = z.object({
  id: z.string().min(1).max(64),                 // device event id
  screenId: z.string().cuid(),
  mediaAssetId: z.string().cuid().nullish(),
  playlistId: z.string().cuid().nullish(),
  source: z.enum(["playlist", "campaign", "schedule"]),
  campaignId: z.string().cuid().nullish(),
  scheduleRuleId: z.string().cuid().nullish(),
  airedAt: z.string().datetime(),                // ISO
  durationSeconds: z.number().int().min(0).max(86400),
});

export const playbackBatchSchema = z.object({
  events: z.array(playbackEventSchema).min(1).max(500),
});
```

Route-level checks after `safeParse` (not expressible in zod alone):

- every `events[i].screenId === screen.id` (the authenticated screen) - else a
  400 problem `"A batch may only contain airings for the reporting screen."`.
- `airedAt` within `[now - 7 days, now + 1 hour]` - events outside the window are
  **dropped silently** (not a batch rejection); a device with a wrong clock or a
  long backlog should not wedge on a 4xx. The response `accepted` count reflects
  only inserted rows.
- `mediaAssetId` / `playlistId` / `campaignId` / `scheduleRuleId` resolved with
  one batched `findMany` per type scoped to `screen.organizationId`; unresolved
  ids are set to `null` before insert.

Response: `200 { accepted: number, duplicates: number, dropped: number }` where
`dropped` counts events removed by the `airedAt` window (so a device can tell the
difference between "you already had these" and "these were too old").

---

## 6. `POST /api/player/events` - route

`src/app/api/player/events/route.ts`. Mirrors `heartbeat/route.ts` scaffolding
(`withRequestId`, `authenticateDevice`, `toProblem`). Steps:

1. `const screen = await authenticateDevice(req)`.
2. `const parsed = playbackBatchSchema.safeParse(await req.json())`; on failure
   return `toProblem` of a 422.
3. Reject the batch (400 problem) if any `screenId !== screen.id`.
4. Partition `events` by the `airedAt` window; count the drops.
5. Batched existence checks for the four id types, scoped to
   `screen.organizationId`; null out the misses.
6. `prisma.playbackEvent.createMany({ data, skipDuplicates: true })`.
7. `NextResponse.json({ accepted: result.count, duplicates: kept.length - result.count, dropped })`.

All reads scoped by `organizationId: screen.organizationId`. Route added to the
existing `src/app/api/player/**` raw-prisma allow-list scope (already covered by
the glob).

---

## 7. RBAC - `src/lib/rbac/policy.ts`

Add `analytics.view` with group `ALL` (read-only, every role including
`VIEWER`). `src/lib/nav.ts`: the `/analytics` entry gains
`action: "analytics.view"`. `policy.test.ts` and `nav.test.ts` extended.

No mutating analytics actions exist - ingest is device-authed, and the page is
read-only - so there are no `analytics.create` / `.delete` actions.

---

## 8. `/analytics` page - `src/app/(app)/analytics/`

### 8.1 `page.tsx` (replaces `ComingSoon`)

Server component. `const ctx = await requireRole("analytics.view")`.
`searchParams: Promise<{ from?: string; to?: string; location?: string; screen?: string }>`.

- `from` / `to` default to the last 30 days (`to` = start of tomorrow UTC,
  `from` = `to - 30d`). Parsed from `"YYYY-MM-DD"`; an invalid value falls back
  to the default. `to` is treated as exclusive end-of-that-day.
- Load the screen list (`id, name, location {id, name}`) and location list
  (`id, name`) for the filter bar.
- Call the four reporting functions with the resolved range + filters (in
  parallel).
- Render:
  - `<AnalyticsFilters>` (client) - two `<input type="date">`, a location
    `<select>`, a screen `<select>`; on change pushes the query string. Grouped
    screen options by location, same pattern as the schedule screen picker.
  - Summary tiles row using `<StatTile>`: **Total plays**, **Play-hours**
    (`totalPlaySeconds / 3600`, one decimal), **Screens reporting**
    (`reportingScreens` of `screens.length`), **Distinct assets**.
  - **Content performance**: `<ContentPerformanceTable>` (sortable client
    component; columns asset, kind, plays, play-hours, screens reached, last
    aired) and `<PlaysByDayChart>` (inline SVG bar chart, one bar per day, a
    hover title with the count; pure props: `byDay`).
  - **Proof of play**: `<ProofOfPlayTable title="Campaigns" rows=...>` and the
    same for `title="Schedule rules"`. Columns: name, airings, duration
    (h:mm), screens, locations, first aired, last aired. Name links to
    `/campaigns/${id}` / `/schedule?screen=...` (rule has no own page; link to
    `/schedule`).
  - Empty state when `summary.totalPlays === 0`: "No playback reported for this
    range. Paired players report airings once they are running."

### 8.2 Components - `src/components/app/analytics/`

- `analytics-filters.tsx` (`"use client"`) - date + location + screen controls.
- `content-performance-table.tsx` (`"use client"`) - client-side column sort
  over the passed rows; no refetch.
- `plays-by-day-chart.tsx` - pure SVG; accepts `byDay: Array<{date, plays}>`;
  renders `<svg>` with a `<rect>` per day scaled to the max, an axis baseline,
  and first / mid / last date labels. No interactivity beyond `<title>`.
- `proof-of-play-table.tsx` - presentational table.

All client components receive only serializable props (ISO strings, numbers,
plain objects) - no `Date`, no functions.

---

## 9. Demo data - `scripts/simulate-analytics.ts`

Mirrors the `simulate-*.ts` family (idempotent, `--force`, targets "Costa Signage
Co"). For each paired, non-offline screen, walk the last 30 days: for each day,
resolve the screen's effective content with the real `resolveScreenContent`
(campaigns / schedule already seeded), take that playlist's ready items via
`assembleManifest` shape, and synthesize a plausible number of loop iterations
for the screen's active hours (e.g. 10 hours * 3600s / loop length), emitting one
`PlaybackEvent` per item per iteration with jittered `durationSeconds` around the
item's configured duration and `airedAt` marching across the day. Cap total rows
(e.g. `take`/slice to ~20k) so the demo stays snappy. Print a summary table
(events, screens, date span, total play-hours). Excluded from typecheck by the
`scripts/simulate-*.ts` glob.

---

## 10. Testing

### 10.1 Pure - `src/lib/analytics/shape.test.ts`

- `zeroFillByDay(rows, from, to)` - fills every day in `[from, to)` with `0`
  where absent, preserves counts where present, output dates are `"YYYY-MM-DD"`
  ascending, handles an empty `rows`, handles `from === to` (empty output),
  spans a month boundary.
- `secondsToHM(n)` / play-hours formatting helper round-trips and pads minutes.
- `withinIngestWindow(airedAt, now)` - true inside `[now-7d, now+1h]`, false at
  `now-7d-1s` and `now+1h+1s`, boundary inclusive.

### 10.2 Ingest integration - `src/app/api/player/events/events.test.ts` (real DB)

Seeds a device-paired screen (reuse the sync-suite helper). Cases:
- a valid batch inserts N rows, `accepted === N`, `duplicates === 0`,
  `dropped === 0`; rows carry the right `organizationId`, `screenId`, resolved
  fks.
- replaying the same batch -> `accepted === 0`, `duplicates === N`, table count
  unchanged (idempotency via the client-supplied pk).
- a batch of 501 -> 413 problem, nothing inserted.
- a batch containing another screen's id -> 400 problem, nothing inserted.
- an event with a `mediaAssetId` that is not in the org -> inserted with
  `mediaAssetId: null`.
- an event with `airedAt` 8 days ago -> not inserted, `dropped === 1`.
- an event with `durationSeconds: -1` -> 422 at the schema (never reaches the
  DB); a direct `prisma.playbackEvent.create` with `-1` -> DB CHECK rejects
  (proves the constraint).
- missing / bad bearer token -> 401 problem.

### 10.3 Reporting - `src/lib/analytics/reports.test.ts` (real DB)

Seed one org, 2 locations, 3 screens, 2 assets, 1 campaign, 1 schedule rule, and
a hand-built set of `PlaybackEvent` rows across 5 days with known counts /
durations. Assert every field of `getPlaybackSummary`, `getContentPerformance`
(including the zero-filled `byDay` and the `"Unattributed"` collapse for
null-asset rows), `getCampaignProofOfPlay`, `getScheduleProofOfPlay`
(`screensReached`, `locationsReached`, first/last). Assert the `locationId` and
`screenId` filters narrow the numbers correctly, and that a deleted campaign
drops out of `getCampaignProofOfPlay`.

### 10.4 RBAC + nav - extend `policy.test.ts`, `nav.test.ts`

`VIEWER` can `analytics.view`; the `/analytics` nav item carries
`action: "analytics.view"`.

### 10.5 Tenant isolation - extend `src/test/isolation/tenant-isolation.spec.ts`

- Fixture: `bPlaybackEventId` in org B.
- Acting as org A: the reporting functions through `forOrg(orgAId)` never see
  org B's event (all four return zero / empty for a range that covers it).
- RLS backstop: under org A's GUC, `SELECT count(*) FROM "PlaybackEvent" WHERE id = '<bPlaybackEventId>'` is 0.
- **Ingest cross-org**: a device authenticated as an org B screen posting a batch
  whose `screenId` is an org A screen -> 400 (screen id mismatch), nothing
  written. A batch for the B screen with a `campaignId` belonging to org A -> the
  campaign id is nulled (not leaked, not inserted as a cross-org ref).

### 10.6 Worker - `src/worker/jobs/analytics.test.ts` (or extend the jobs test)

`prunePlaybackEvents(now)` deletes only rows with `airedAt < now - 90d`, returns
the count, leaves newer rows, runs across multiple orgs in one pass.

### 10.7 e2e - `src/test/e2e/analytics.spec.ts`

Register a fresh org, seed a screen + a handful of `PlaybackEvent` rows via
`@/lib/db/root`, sign in, open `/analytics`: assert the summary tiles show the
seeded totals, the content table lists the seeded asset, the plays-by-day chart
renders bars; change the `from` date to exclude some events and assert the
totals drop.

---

## 11. Deliverables

1. `prisma/schema.prisma` + `prisma/migrations/<ts>_analytics/migration.sql`
   (1 table + FKs + CHECK + RLS block).
2. `prisma/analytics-schema.test.ts` (schema text + live CHECK / FK behaviour).
3. `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts` (-> 34);
   `tenant-model-list.test.ts` stays green.
4. `src/lib/validation/analytics.ts` + `analytics.test.ts`.
5. `src/app/api/player/events/route.ts` + `events.test.ts`.
6. `src/lib/analytics/{summary,content,proof-of-play,shape}.ts` + `shape.test.ts`
   + `reports.test.ts`.
7. `src/lib/rbac/policy.ts` + `policy.test.ts`; `src/lib/nav.ts` + `nav.test.ts`.
8. `src/app/(app)/analytics/page.tsx` (replaces `ComingSoon`).
9. `src/components/app/analytics/{analytics-filters,content-performance-table,plays-by-day-chart,proof-of-play-table}.tsx` + `.test.tsx`.
10. `src/worker/jobs/prunePlaybackEvents.ts` + `src/worker/index.ts` wiring + test.
11. `src/test/isolation/tenant-isolation.spec.ts` extension.
12. `src/test/e2e/analytics.spec.ts`.
13. `scripts/simulate-analytics.ts`.
14. `docs/architecture.md` - Analytics section + roadmap (Analytics shipped;
    note the next open items).

---

## 12. Risks and open questions

- **Compute-on-read scaling.** Every `/analytics` load runs 4 aggregate queries
  over the raw table. Indexed by `(organizationId, airedAt)` and the id+airedAt
  composites, a 30-day range for one org is bounded; a very large org over a
  90-day range could be slow. The 90-day prune caps the worst case. Rollups are
  the documented next step if it bites.
- **Device clock trust.** `airedAt` is the device clock. The `[now-7d, now+1h]`
  window bounds the damage from a wrong clock; `byDay` bucketing at UTC can put
  an airing on the "wrong" calendar day for a device far from UTC. Acceptable
  for v1; a per-screen timezone bucketing pass is a later refinement (the
  screen's location already has `timeZone`).
- **`skipDuplicates` and partial batches.** `createMany({ skipDuplicates: true })`
  silently ignores pk collisions, which is exactly the idempotency behaviour we
  want, but it also masks a device that reuses ids for *different* airings. The
  `id` contract (device event id, unique per device) is documented in the route
  and the spec; a misbehaving device under-reports rather than corrupts. The
  primary key is composite, `(organizationId, id)`, so the identity is
  tenant-local: `skipDuplicates` dedupes on the pair, and a client-supplied id
  from one tenant can never collide with, suppress, or probe for another
  tenant's row.
- **No auth on `dropped` semantics.** A device cannot distinguish "dropped for
  bad clock" from a bug on our side except via the `dropped` count. That is
  enough for field debugging without adding a per-event error array.
- **Demo script cost.** `simulate-analytics.ts` can generate a lot of rows; the
  spec caps it. If it is still slow it should `createMany` in chunks.
