# Analytics (Proof-of-Play) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship LyneSign Analytics (proof-of-play): paired players batch-report the content they displayed to `POST /api/player/events`; the server stores one idempotent row per airing in a tenant-scoped `PlaybackEvent` table; `/analytics` aggregates those rows on read into summary tiles, a content-performance report, and campaign / schedule proof-of-play; a worker task prunes raw events older than 90 days.

**Architecture:** One new tenant-scoped, RLS-forced table (`PlaybackEvent`) with a client-supplied primary key used as the idempotency key. A device-authed batch ingest route mirrors `heartbeat/route.ts`. Reporting is compute-on-read: four functions in `src/lib/analytics/` run parameterized aggregate queries through the tenant facade, using Prisma `groupBy` where it fits and `$queryRaw` for `COUNT(DISTINCT ...)` / `date_trunc`. The page is a server component with a client filter bar; charts are hand-rolled inline SVG. Retention is a worker job modeled on `purgeArchivedMedia`. No new dependencies; no rollup tables; no per-screen page; no change to `GET /api/player/sync`.

**Tech Stack:** Next.js 16.2.11, React 19, Prisma 6.19.x + `@prisma/adapter-pg`, PostgreSQL, `zod@^4`, Vitest, Playwright.

**Spec:** `docs/specs/2026-09-02-analytics-design.md`

## Global Constraints

- Branch `analytics` off `main` (merge-base at `d798191` `docs: analytics increment design spec`, already on `main`). Runtime pins unchanged (`next@16.2.11`, `react@19.2.4`, `prisma`/`@prisma/client`/`@prisma/adapter-pg@^6.19.x`, `zod@^4`). TypeScript `strict`.
- Every tenant-data read/write goes through `forOrg` / `withOrgTransaction`, EXCEPT the device-authed route `src/app/api/player/events/route.ts`, which (like `sync` and `heartbeat`) uses the root `prisma` client - already covered by the ESLint `RAW_PRISMA_ALLOWED` glob `src/app/api/player/**` - and scopes every read with `organizationId: screen.organizationId`.
- `PlaybackEvent` is added to **all three** lists: the feature migration `ARRAY` (`ARRAY['PlaybackEvent']` in the RLS `DO` block), `TENANT_MODELS` (`src/lib/db/tenant.ts`, camelCase `"playbackEvent"`), `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`, PascalCase `"PlaybackEvent"`). `src/lib/db/tenant-model-list.test.ts` checks the three lists by set equality and has NO count literal - it must stay green, and needs no count edit.
- RLS policy predicate for `PlaybackEvent` is **byte-identical** to migration `20260830032500_rls_empty_guc_is_unscoped`: `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`, both USING and WITH CHECK, with `ENABLE` + `FORCE ROW LEVEL SECURITY`. Match the hand-appended `DO $$ ... FOREACH t IN ARRAY ARRAY[...]` block at the tail of `prisma/migrations/20260901203759_schedule/migration.sql`.
- One named DB CHECK, added in the migration SQL after the generated DDL: `playback_event_duration_nonneg` = `"durationSeconds" >= 0 AND "durationSeconds" <= 86400`.
- `PlaybackEvent.id` has NO `@default` - it is the client-supplied device event id. Inserts use `prisma.playbackEvent.createMany({ data, skipDuplicates: true })` so a replayed batch is a no-op.
- FK `onDelete`: `organization` and `screen` are `Cascade`; `mediaAsset`, `playlist`, `campaign`, `scheduleRule` are `SetNull` (an event outlives the content it references).
- The ingest route writes NO audit rows (volume). `prunePlaybackEvents` writes NO audit rows (retention is not an org action).
- Ingest `airedAt` acceptance window is `[now - 7 days, now + 1 hour]`, inclusive. Events outside it are **dropped silently** (counted in the `dropped` field of the 200 response), never a 4xx.
- Ingest response is always `200 { accepted: number, duplicates: number, dropped: number }` on a well-formed batch. Malformed body -> 422 problem. Batch length > 500 -> 413 problem. Any `screenId` in the batch that is not the authenticated screen -> 400 problem, nothing written.
- Reporting functions take `(db: TenantClient, range: { from: Date; to: Date; locationId?: string; screenId?: string })`. `from` inclusive, `to` exclusive. `db` is `ctx.db` (facade). Raw queries run inside `withOrgTransaction` when they need `$queryRaw`, and are fully parameterized - never interpolate caller input.
- Copy rules: no em dashes, no emojis, no exclamation points in any user-facing string, error, problem detail, log line, or doc prose. End error strings with a period.
- No new npm dependencies. Charts are inline `<svg>`. Date entry is `<input type="date">`. Dates cross the RSC boundary as `"YYYY-MM-DD"` or ISO strings, never `Date` objects; no functions as props.
- Server action / route pattern for the page: `requireRole("analytics.view")` first. The page is read-only - no mutations, no `writeAudit`, no `revalidatePath`.
- TDD: write the failing test, run it and watch it fail, implement the minimum, run it and watch it pass, commit. Conventional Commits.
- Commands run from `lynesign/`. `npm run db:up` and `npm run storage:up` must both be running for integration/e2e suites. If Postgres will not start with "not accepting connections", `rm -f .pgdata/postmaster.pid` then retry.
- `npm run test` truncates the dev database. After any integration/e2e run, the demo login and `simulate-*` data must be rebuilt before using the app. Do not rely on dev data surviving a test run. Run only the focused suites each task names.
- A concurrent session may have uncommitted edits to `tsconfig.json` / `scripts/simulate-account.ts` in the working tree. They are not part of this branch. Do not touch or stage them; assess only NEW problems in `src/` / `prisma/`.
- Known baseline: `npm run test` is 472 passing on `main` with services up.

---

## File Structure

```
lynesign/
  prisma/
    schema.prisma                                     # + PlaybackEvent, back-relations
    migrations/<ts>_analytics/migration.sql           # 1 table + FKs + CHECK + RLS DO block
    analytics-schema.test.ts                          # NEW - schema text + live CHECK/FK behaviour
  src/
    lib/
      db/tenant.ts                                    # TENANT_MODELS += playbackEvent
      rbac/policy.ts                                  # Action union + POLICY += analytics.view (ALL)
      rbac/policy.test.ts                             # + analytics.view case
      nav.ts                                          # /analytics item gets action: "analytics.view"
      nav.test.ts                                     # + /analytics gate case
      validation/analytics.ts                         # NEW - playbackEventSchema, playbackBatchSchema, withinIngestWindow
      validation/analytics.test.ts                    # NEW
      analytics/shape.ts                              # NEW - zeroFillByDay, secondsToHM
      analytics/shape.test.ts                         # NEW
      analytics/summary.ts                            # NEW - getPlaybackSummary
      analytics/content.ts                            # NEW - getContentPerformance
      analytics/proof-of-play.ts                      # NEW - getCampaignProofOfPlay, getScheduleProofOfPlay
      analytics/reports.test.ts                       # NEW - all four functions against a seeded event set
    test/isolation/tenant-tables.ts                   # TENANT_TABLES += PlaybackEvent
    app/
      (app)/analytics/page.tsx                        # replace ComingSoon
      api/player/events/route.ts                      # NEW - device-authed batch ingest
      api/player/events/events.test.ts                # NEW
    components/app/analytics/                          # NEW
      analytics-filters.tsx
      content-performance-table.tsx
      plays-by-day-chart.tsx
      proof-of-play-table.tsx
      analytics-filters.test.tsx
      content-performance-table.test.tsx
      plays-by-day-chart.test.tsx
    worker/
      jobs/prunePlaybackEvents.ts                     # NEW
      jobs/prune.test.ts                              # NEW (or extend an existing jobs test)
      index.ts                                        # + interval + guard + runPrunePlayback()
    test/isolation/tenant-isolation.spec.ts           # + PlaybackEvent cross-org + RLS backstop + ingest cross-org
    test/e2e/analytics.spec.ts                        # NEW
  docs/architecture.md                                # + Analytics section, roadmap update
  scripts/simulate-analytics.ts                       # NEW - demo playback events (excluded from typecheck)
```

---

## Task 1: Schema, migration, RLS, list sync

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_analytics/migration.sql`
- Modify: `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts`
- Test: `prisma/analytics-schema.test.ts`
- Existing test that must stay green: `src/lib/db/tenant-model-list.test.ts`

**Interfaces:**
- Produces the `PlaybackEvent` model exactly as spec section 4:
  - `id String @id` (NO `@default`), `organizationId String`, `screenId String`, `mediaAssetId String?`, `playlistId String?`, `source String`, `campaignId String?`, `scheduleRuleId String?`, `airedAt DateTime @db.Timestamptz(3)`, `durationSeconds Int`, `receivedAt DateTime @default(now()) @db.Timestamptz(3)`.
  - Relations: `organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)`, `screen Screen @relation(fields: [screenId], references: [id], onDelete: Cascade)`, `mediaAsset MediaAsset? @relation(fields: [mediaAssetId], references: [id], onDelete: SetNull)`, `playlist Playlist? @relation(fields: [playlistId], references: [id], onDelete: SetNull)`, `campaign Campaign? @relation(fields: [campaignId], references: [id], onDelete: SetNull)`, `scheduleRule ScheduleRule? @relation(fields: [scheduleRuleId], references: [id], onDelete: SetNull)`.
  - Indexes: `@@index([organizationId, airedAt])`, `@@index([organizationId, mediaAssetId, airedAt])`, `@@index([organizationId, campaignId, airedAt])`, `@@index([organizationId, scheduleRuleId, airedAt])`, `@@index([screenId, airedAt])`.
  - Back-relations: `Organization.playbackEvents PlaybackEvent[]`, `Screen.playbackEvents PlaybackEvent[]`, `MediaAsset.playbackEvents PlaybackEvent[]`, `Playlist.playbackEvents PlaybackEvent[]`, `Campaign.playbackEvents PlaybackEvent[]`, `ScheduleRule.playbackEvents PlaybackEvent[]`.
- Migration adds the CHECK `playback_event_duration_nonneg` (`"durationSeconds" >= 0 AND "durationSeconds" <= 86400`) and the RLS `DO` block for `ARRAY['PlaybackEvent']`.
- `TENANT_MODELS` gains `"playbackEvent"`; `TENANT_TABLES` gains `"PlaybackEvent"`.

- [ ] **Step 1: schema text test (write, run, fail)** -- `prisma/analytics-schema.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const block = (name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))![0];

describe("playback event schema", () => {
  it("declares the model", () => {
    expect(schema).toMatch(/model PlaybackEvent \{/);
  });
  it("id is client-supplied (no @default)", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/\n\s*id\s+String\s+@id\s*\n/);
    expect(b).not.toMatch(/id\s+String\s+@id\s+@default/);
  });
  it("content fks are optional and SetNull", () => {
    const b = block("PlaybackEvent");
    for (const rel of ["mediaAsset", "playlist", "campaign", "scheduleRule"]) {
      expect(b).toMatch(new RegExp(`${rel}\\s+\\w+\\?\\s+@relation\\([^)]*onDelete:\\s*SetNull`));
    }
  });
  it("screen and organization cascade", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/screen\s+Screen\s+@relation\([^)]*onDelete:\s*Cascade/);
    expect(b).toMatch(/organization\s+Organization\s+@relation\([^)]*onDelete:\s*Cascade/);
  });
  it("has the airedAt composite indexes", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/@@index\(\[organizationId, airedAt\]\)/);
    expect(b).toMatch(/@@index\(\[organizationId, mediaAssetId, airedAt\]\)/);
  });
});
```
Run: `npx vitest run prisma/analytics-schema.test.ts` -- Expected: FAIL (model absent).

- [ ] **Step 2: edit `prisma/schema.prisma`** -- add the `PlaybackEvent` model and every back-relation field. Place it after the `ScheduleRule*` blocks.

- [ ] **Step 3: generate the migration SQL, do not apply** -- `npx prisma migrate dev --name analytics --create-only`. If it needs a shadow database this embedded setup lacks, instead run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<YYYYMMDDHHMMSS>_analytics/migration.sql` (create the dir first; timestamp a few seconds after `20260901203759`).

- [ ] **Step 4: hand-append to the migration SQL** -- after the generated DDL:
  ```sql
  ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "playback_event_duration_nonneg"
    CHECK ("durationSeconds" >= 0 AND "durationSeconds" <= 86400);
  ```
  then the RLS `DO $$` block copied verbatim from the tail of `prisma/migrations/20260901203759_schedule/migration.sql`, with the array changed to `ARRAY['PlaybackEvent']`. Predicate text byte-identical.

- [ ] **Step 5: apply** -- `npx prisma migrate deploy` then `npx prisma generate`. Expected: applies cleanly, client regenerates with the `playbackEvent` delegate.

- [ ] **Step 6: sync the two tenant lists**
  - `src/lib/db/tenant.ts`: append `"playbackEvent"` to `TENANT_MODELS`.
  - `src/test/isolation/tenant-tables.ts`: append `"PlaybackEvent"` to `TENANT_TABLES`.
  - `src/lib/db/tenant-model-list.test.ts`: no change (set-equality check, no count literal). Confirm it stays green.

- [ ] **Step 7: CHECK/FK behaviour test (write, run, pass)** -- extend `prisma/analytics-schema.test.ts` with a `describe` using the root `prisma` client against the live dev DB (mirror `prisma/schedule-schema.test.ts` structure):
  - inserting a `PlaybackEvent` with `durationSeconds: -1` rejects with `playback_event_duration_nonneg`; with `86401` rejects likewise; with `0` and `86400` succeed.
  - a `PlaybackEvent` with an explicit `id` string is stored under that id; a second `createMany` with the same `id` and `skipDuplicates: true` inserts 0 rows and does not throw.
  - deleting the referenced `MediaAsset` nulls `mediaAssetId` on the event (row still present); deleting the `Screen` deletes the event (cascade).
  Clean up rows in `afterEach`. Run: `npx vitest run prisma/analytics-schema.test.ts` -- Expected: PASS.

- [ ] **Step 8: regression** -- `npx vitest run src/lib/db/` -- Expected: PASS (tenant-model-list green).

- [ ] **Step 9: Commit** -- `git add -A && git commit -m "feat: playback event schema, migration, RLS, tenant lists"`

---

## Task 2: RBAC action and nav gate

**Files:**
- Modify: `src/lib/rbac/policy.ts`, `src/lib/nav.ts`
- Test: `src/lib/rbac/policy.test.ts`, `src/lib/nav.test.ts`

**Interfaces:**
- Produces: `Action` union gains `"analytics.view"`; `POLICY["analytics.view"] = ALL` (the same constant `campaign.view` / `schedule.view` use). `nav.ts` `/analytics` entry gains `action: "analytics.view"`.

- [ ] **Step 1: policy test (write, run, fail)** -- in `src/lib/rbac/policy.test.ts` add cases mirroring the `schedule.view` block: `can({ role: "VIEWER", ... }, "analytics.view")` is true; true for every other role too. Run: `npx vitest run src/lib/rbac/policy.test.ts` -- FAIL.

- [ ] **Step 2: add the action** -- extend the `Action` union and `POLICY` map next to `schedule.view`, reusing the `ALL` constant.

- [ ] **Step 3: run policy test** -- PASS.

- [ ] **Step 4: nav test (write, run, fail)** -- in `src/lib/nav.test.ts` assert the `/analytics` item has `action: "analytics.view"` (copy the `/schedule` assertion). FAIL.

- [ ] **Step 5: edit `src/lib/nav.ts`** -- add `action: "analytics.view"` to the `/analytics` entry.

- [ ] **Step 6: run nav + rbac suites** -- `npx vitest run src/lib/rbac/ src/lib/nav.test.ts` -- PASS.

- [ ] **Step 7: Commit** -- `git commit -am "feat: analytics.view RBAC action and nav gate"`

---

## Task 3: Ingest validation -- `src/lib/validation/analytics.ts`

**Files:**
- Create: `src/lib/validation/analytics.ts`, `src/lib/validation/analytics.test.ts`

**Interfaces:**
- Produces:
  - `playbackEventSchema` (zod object) exactly as spec section 5: `id` `z.string().min(1).max(64)`, `screenId` `z.string().cuid()`, `mediaAssetId`/`playlistId`/`campaignId`/`scheduleRuleId` each `z.string().cuid().nullish()`, `source` `z.enum(["playlist", "campaign", "schedule"])`, `airedAt` `z.string().datetime()`, `durationSeconds` `z.number().int().min(0).max(86400)`.
  - `playbackBatchSchema` = `z.object({ events: z.array(playbackEventSchema).min(1).max(500) })`.
  - `export function withinIngestWindow(airedAt: Date, now: Date): boolean` -- true iff `airedAt >= now - 7*86400*1000` AND `airedAt <= now + 3600*1000` (both bounds inclusive).
  - `export type PlaybackEventInput = z.infer<typeof playbackEventSchema>`.
- Consumed by Task 5 (route) and Task 12 (demo script may reuse the type).

- [ ] **Step 1: write `analytics.test.ts` (run, fail)**:
```ts
import { describe, it, expect } from "vitest";
import { playbackBatchSchema, withinIngestWindow } from "./analytics";

const ok = {
  id: "evt-1", screenId: "ckxym0000000000000000000a", source: "playlist",
  airedAt: "2026-09-01T10:00:00.000Z", durationSeconds: 15,
};

describe("playbackBatchSchema", () => {
  it("accepts a minimal valid batch", () => {
    expect(playbackBatchSchema.safeParse({ events: [ok] }).success).toBe(true);
  });
  it("rejects an empty batch", () => {
    expect(playbackBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });
  it("rejects more than 500 events", () => {
    expect(playbackBatchSchema.safeParse({ events: Array(501).fill(ok) }).success).toBe(false);
  });
  it("rejects a negative duration", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, durationSeconds: -1 }] }).success).toBe(false);
  });
  it("rejects a bad source", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, source: "none" }] }).success).toBe(false);
  });
  it("rejects a non-ISO airedAt", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, airedAt: "2026-09-01" }] }).success).toBe(false);
  });
  it("allows null content ids", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, mediaAssetId: null, campaignId: null }] }).success).toBe(true);
  });
});

describe("withinIngestWindow", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  it("accepts an event from an hour ago", () => {
    expect(withinIngestWindow(new Date("2026-09-08T11:00:00.000Z"), now)).toBe(true);
  });
  it("accepts the 7-day-old boundary", () => {
    expect(withinIngestWindow(new Date("2026-09-01T12:00:00.000Z"), now)).toBe(true);
  });
  it("rejects 7 days and one second old", () => {
    expect(withinIngestWindow(new Date("2026-09-01T11:59:59.000Z"), now)).toBe(false);
  });
  it("accepts up to one hour in the future", () => {
    expect(withinIngestWindow(new Date("2026-09-08T13:00:00.000Z"), now)).toBe(true);
  });
  it("rejects more than one hour in the future", () => {
    expect(withinIngestWindow(new Date("2026-09-08T13:00:01.000Z"), now)).toBe(false);
  });
});
```
Run: `npx vitest run src/lib/validation/analytics.test.ts` -- FAIL.

- [ ] **Step 2: implement `src/lib/validation/analytics.ts`** per the Interfaces block.

- [ ] **Step 3: run the test** -- PASS.

- [ ] **Step 4: Commit** -- `git commit -am "feat: playback ingest validation schema"`

---

## Task 4: Pure shape helpers -- `src/lib/analytics/shape.ts`

**Files:**
- Create: `src/lib/analytics/shape.ts`, `src/lib/analytics/shape.test.ts`

**Interfaces:**
- Produces:
  - `export function zeroFillByDay(rows: Array<{ date: string; plays: number }>, from: Date, to: Date): Array<{ date: string; plays: number }>` -- one entry per UTC day in `[from, to)` (using `from`'s and `to`'s calendar dates), ascending by `date` (`"YYYY-MM-DD"`), `plays` taken from a matching `rows` entry or `0`. `from >= to` yields `[]`. Extra `rows` outside the range are ignored.
  - `export function secondsToHM(totalSeconds: number): string` -- `"H:MM"` (hours unbounded, minutes zero-padded, seconds dropped). `secondsToHM(0) === "0:00"`, `secondsToHM(3661) === "1:01"`.
  - `export function playHours(totalSeconds: number): string` -- `(totalSeconds / 3600)` to one decimal as a string, e.g. `"12.5"`.

- [ ] **Step 1: write `shape.test.ts` (run, fail)** -- cover: `zeroFillByDay` with a 3-day range and rows for day 2 only -> `[{d1,0},{d2,n},{d3,0}]`; empty rows -> all zeros; `from === to` -> `[]`; a range crossing a month boundary (2026-01-30 to 2026-02-02) -> `["2026-01-30","2026-01-31","2026-02-01"]`; a `rows` entry whose date is outside the range is dropped. `secondsToHM`: `0 -> "0:00"`, `59 -> "0:00"`, `60 -> "0:01"`, `3661 -> "1:01"`, `36000 -> "10:00"`. `playHours`: `0 -> "0.0"`, `1800 -> "0.5"`, `45000 -> "12.5"`. Run: `npx vitest run src/lib/analytics/shape.test.ts` -- FAIL.

- [ ] **Step 2: implement `src/lib/analytics/shape.ts`** -- use `toISOString().slice(0, 10)` for day keys; iterate with a `Date` incremented by `setUTCDate(+1)`.

- [ ] **Step 3: run the test** -- PASS.

- [ ] **Step 4: Commit** -- `git commit -am "feat: pure analytics shape helpers"`

---

## Task 5: `POST /api/player/events` -- batch ingest route

**Files:**
- Create: `src/app/api/player/events/route.ts`, `src/app/api/player/events/events.test.ts`

**Interfaces:**
- Consumes: `authenticateDevice` (`src/lib/player/device-auth.ts`), `playbackBatchSchema` + `withinIngestWindow` (Task 3), `toProblem` / `withRequestId` (as in `heartbeat/route.ts`).
- Produces: `export async function POST(req: NextRequest): Promise<NextResponse>`.
  - 401 problem on bad/missing bearer token.
  - 422 problem (`toProblem` of a `new ValidationError(...)` or the repo's equivalent - match how other routes surface a zod failure) when `playbackBatchSchema.safeParse` fails.
  - 413 problem when `events.length > 500` (the schema already caps at 500, so this is reached only if you check length before parse; simplest: let the schema fail and map the "too_big" issue to 413, OR check `Array.isArray(body?.events) && body.events.length > 500` before parse and return 413. Pick one and note it.).
  - 400 problem `"A batch may only contain airings for the reporting screen."` if any `events[i].screenId !== screen.id`.
  - Otherwise: partition by `withinIngestWindow(new Date(e.airedAt), now)`, count `dropped`. For the kept events, one `findMany` per id type (`mediaAsset`, `playlist`, `campaign`, `scheduleRule`) scoped `where: { id: { in: [...] }, organizationId: screen.organizationId }`, build a `Set` of resolvable ids, null the misses. `prisma.playbackEvent.createMany({ data: rows, skipDuplicates: true })`. Respond `200 { accepted: result.count, duplicates: kept.length - result.count, dropped }`.
- All reads scoped by `organizationId: screen.organizationId`.

- [ ] **Step 1: write `events.test.ts` (run, fail)** -- mirror `src/app/api/player/sync/sync.test.ts` scaffolding (`hashDeviceToken`, `NextRequest` with `authorization: Bearer <token>`, direct `import("@/app/api/player/events/route")`). Helper seeds an org + location + a device-paired screen (+ a second screen, + a media asset, + optionally a campaign). Cases from spec 10.2:
  - valid 3-event batch -> `{ accepted: 3, duplicates: 0, dropped: 0 }`, rows have the right `organizationId` / `screenId` / resolved `mediaAssetId`.
  - replay the same batch -> `{ accepted: 0, duplicates: 3, dropped: 0 }`, table count unchanged.
  - 501-event batch -> 413.
  - batch with one event whose `screenId` is the second screen -> 400, `playbackEvent.count === 0`.
  - event with a `mediaAssetId` not in the org -> inserted with `mediaAssetId: null`.
  - event with `airedAt` 8 days ago -> not inserted, `dropped: 1`.
  - no Authorization header -> 401.
  Run: `npx vitest run src/app/api/player/events/events.test.ts` -- FAIL.

- [ ] **Step 2: implement the route** per Interfaces, scaffolding copied from `src/app/api/player/heartbeat/route.ts`.

- [ ] **Step 3: run the test + the player suite** -- `npx vitest run src/app/api/player/` -- PASS.

- [ ] **Step 4: typecheck** -- `npm run typecheck` -- no new errors.

- [ ] **Step 5: Commit** -- `git commit -am "feat: device batch ingest at POST /api/player/events"`

---

## Task 6: `getPlaybackSummary` + `getContentPerformance`

**Files:**
- Create: `src/lib/analytics/summary.ts`, `src/lib/analytics/content.ts`
- Test: `src/lib/analytics/reports.test.ts` (create; extended again in Task 7)

**Interfaces:**
- Consumes: `zeroFillByDay` (Task 4); `TenantClient` / `TenantTransactionClient` types from `src/lib/db/tenant.ts`.
- Produces:
  - `export type AnalyticsRange = { from: Date; to: Date; locationId?: string; screenId?: string }`.
  - `export async function getPlaybackSummary(db: TenantClient, range: AnalyticsRange): Promise<{ totalPlays: number; totalPlaySeconds: number; reportingScreens: number; distinctAssets: number }>`.
  - `export async function getContentPerformance(db: TenantClient, range: AnalyticsRange): Promise<{ rows: Array<{ mediaAssetId: string; assetName: string; kind: string | null; plays: number; playSeconds: number; screensReached: number; lastAiredAt: string }>; byDay: Array<{ date: string; plays: number }> }>`.
    - Null-`mediaAssetId` rows collapse into one row: `mediaAssetId: ""`, `assetName: "Unattributed"`, `kind: null`.
    - `byDay` is `zeroFillByDay`-ed over `[from, to)`.
    - `rows` ordered by `plays` desc, then `assetName` asc.
- **Authoritative signatures:** `getPlaybackSummary(orgId: string, range: AnalyticsRange)` and `getContentPerformance(orgId: string, range: AnalyticsRange)`. They take the bare `orgId` (not a `db` handle) because they need `tx.$queryRaw`, which lives on the transaction client, not on `TenantClient`. Each opens exactly one `withOrgTransaction(orgId, async (tx) => { ... })` and does ALL its reads on `tx` -- Prisma `groupBy` / `count` for the simple aggregates, parameterized `tx.$queryRaw` for `COUNT(DISTINCT screenId)` and `date_trunc('day', "airedAt")`. `withOrgTransaction` sets the org GUC so RLS scopes every read; do not add a manual `organizationId` filter.
- The range/filter `where` fragment used by every read: `{ airedAt: { gte: range.from, lt: range.to }, ...(range.screenId ? { screenId: range.screenId } : {}), ...(range.locationId ? { screen: { locationId: range.locationId } } : {}) }`.
- Call sites (the page in Task 8, the tests) pass `ctx.organizationId`.

- [ ] **Step 1: seed helper + summary test (write, run, fail)** -- `src/lib/analytics/reports.test.ts`: a `beforeEach` that `resetDb()` + `seedPlans()` and builds a fixture: 1 org, 2 locations, 3 screens (2 in loc A, 1 in loc B), 2 media assets, and ~12 `PlaybackEvent` rows across 5 days with hand-computed totals (some null-asset rows, known per-day counts, known durations). Assert `getPlaybackSummary(org.id, { from, to })` returns the exact `totalPlays`, `totalPlaySeconds`, `reportingScreens` (distinct screenIds with an event), `distinctAssets` (distinct non-null mediaAssetId). Assert the `locationId` filter drops loc B's events and `screenId` narrows to one screen. Run: `npx vitest run src/lib/analytics/reports.test.ts` -- FAIL.

- [ ] **Step 2: implement `src/lib/analytics/summary.ts`**.

- [ ] **Step 3: content-performance test (write, run, fail)** -- extend `reports.test.ts`: assert `getContentPerformance` `rows` (per-asset plays / playSeconds / screensReached / lastAiredAt, ordering, and the collapsed `"Unattributed"` row) and `byDay` (zero-filled, one entry per day in range, ascending). Run -- FAIL.

- [ ] **Step 4: implement `src/lib/analytics/content.ts`**.

- [ ] **Step 5: run `reports.test.ts` + typecheck** -- `npx vitest run src/lib/analytics/ && npm run typecheck` -- PASS / clean.

- [ ] **Step 6: Commit** -- `git commit -am "feat: playback summary and content performance reports"`

---

## Task 7: `getCampaignProofOfPlay` + `getScheduleProofOfPlay`

**Files:**
- Create: `src/lib/analytics/proof-of-play.ts`
- Test: `src/lib/analytics/reports.test.ts` (extend)

**Interfaces:**
- Consumes: `AnalyticsRange` (Task 6); `withOrgTransaction`.
- Produces:
  - `export async function getCampaignProofOfPlay(orgId: string, range: AnalyticsRange): Promise<ProofRow[]>`
  - `export async function getScheduleProofOfPlay(orgId: string, range: AnalyticsRange): Promise<ProofRow[]>`
  - `type ProofRow = { id: string; name: string; airings: number; playSeconds: number; screensReached: number; locationsReached: number; firstAiredAt: string; lastAiredAt: string }` (exported).
  - Grouped by `campaignId` / `scheduleRuleId` (non-null only), joined to `Campaign` / `ScheduleRule` for `name`; a group whose entity no longer exists (name join misses) is DROPPED. `screensReached` = `COUNT(DISTINCT screenId)`; `locationsReached` = `COUNT(DISTINCT location of those screens)` (join `Screen.locationId`). Ordered by `airings` desc, then `name` asc. ISO strings for the dates.

- [ ] **Step 1: proof-of-play test (write, run, fail)** -- extend `reports.test.ts` fixture with 1 campaign + 1 schedule rule referenced by some events, and one campaign that is then deleted (its events keep `campaignId: null` via SetNull, so they fall out). Assert both functions' rows field-by-field, the drop of the deleted campaign, and the `locationId` filter behaviour. Run -- FAIL.

- [ ] **Step 2: implement `src/lib/analytics/proof-of-play.ts`**.

- [ ] **Step 3: run `reports.test.ts` + typecheck** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: campaign and schedule proof-of-play reports"`

---

## Task 8: `/analytics` page + filter bar

**Files:**
- Modify: `src/app/(app)/analytics/page.tsx` (replace `ComingSoon`)
- Create: `src/components/app/analytics/analytics-filters.tsx`, `src/components/app/analytics/analytics-filters.test.tsx`

**Interfaces:**
- Consumes: `requireRole("analytics.view")`, `can`, the four reporting functions (Tasks 6-7), `StatTile`, `PageHeader`.
- Produces:
  - `AnalyticsPage` server component. `searchParams: Promise<{ from?: string; to?: string; location?: string; screen?: string }>`. Resolves the range (default: `to` = start of tomorrow UTC, `from` = `to - 30d`; parse `"YYYY-MM-DD"`, fall back to default on invalid; `to` param is treated as end-of-that-day so add one day when building the exclusive bound). Loads screen list (`id, name, location {id, name}`) and location list (`id, name`). Calls `getPlaybackSummary` / `getContentPerformance` / `getCampaignProofOfPlay` / `getScheduleProofOfPlay` in `Promise.all` with `ctx.organizationId` + the range. Renders `PageHeader`, `<AnalyticsFilters>`, the summary `StatTile` row, and (Task 9) the tables + chart -- until Task 9 lands, render a `<pre>` of the serialized report data as a placeholder.
  - `AnalyticsFilters` (`"use client"`): props `{ from: string; to: string; screens: Array<{ id; name; location: { id; name } }>; locations: Array<{ id; name }>; selectedLocation?: string; selectedScreen?: string }`. Two `<input type="date">` (from / to), a location `<select>`, a screen `<select>` grouped by `<optgroup>` per location. On any change, `router.push` a new query string preserving the other params. Accessible labels.

- [ ] **Step 1: filter component test (write, run, fail)** -- render with 2 locations / 3 screens; assert the date inputs show `from` / `to`; assert the screen select is grouped by `<optgroup>`; assert changing the `from` date calls `router.push` with `from=<new>` and the existing `to` / `location` preserved. Run: `npx vitest run src/components/app/analytics/analytics-filters.test.tsx` -- FAIL.

- [ ] **Step 2: implement `analytics-filters.tsx`**.

- [ ] **Step 3: run filter test** -- PASS.

- [ ] **Step 4: implement `page.tsx`** -- replace `ComingSoon`; render the filter bar + `StatTile` row + a `<pre>` placeholder holding `JSON.stringify({ summary, content, campaigns, schedule }, ...)` for Task 9 to replace.

- [ ] **Step 5: typecheck** -- `npm run typecheck` -- no new errors.

- [ ] **Step 6: Commit** -- `git commit -am "feat: /analytics page and filter bar"`

---

## Task 9: Report tables + plays-by-day chart

**Files:**
- Create: `src/components/app/analytics/content-performance-table.tsx`, `src/components/app/analytics/plays-by-day-chart.tsx`, `src/components/app/analytics/proof-of-play-table.tsx`
- Create: `src/components/app/analytics/content-performance-table.test.tsx`, `src/components/app/analytics/plays-by-day-chart.test.tsx`
- Modify: `src/app/(app)/analytics/page.tsx` (swap the `<pre>` for the real components)

**Interfaces:**
- Consumes: the serialized report shapes from Tasks 6-7; `secondsToHM` / `playHours` (Task 4).
- Produces:
  - `ContentPerformanceTable` (`"use client"`): props `{ rows: ContentRow[] }`. A `<table>` with client-side column sort (click a header to sort by that column asc/desc; default plays desc). Columns: Asset, Kind, Plays, Play hours (`playHours(playSeconds)`), Screens, Last aired (date). No refetch.
  - `PlaysByDayChart` (pure, no `"use client"` needed if it takes only props and renders SVG): props `{ byDay: Array<{ date: string; plays: number }> }`. Renders an `<svg>` with a `<rect>` per day, height scaled to `max(plays, 1)`, a baseline, and three `<text>` labels (first, middle, last date). Each `<rect>` has a `<title>` of `"<date>: <plays> plays"`. Renders a short "No plays in this range." text when every `plays` is 0.
  - `ProofOfPlayTable`: props `{ title: string; rows: ProofRow[]; hrefFor: (id: string) => string }` -- wait, no functions as props across the RSC boundary. Instead: `{ title: string; kind: "campaign" | "schedule"; rows: ProofRow[] }` and the component builds the href internally (`/campaigns/${id}` for `"campaign"`, `/schedule` for `"schedule"`). Columns: Name (link), Airings, Duration (`secondsToHM(playSeconds)`), Screens, Locations, First aired, Last aired.

- [ ] **Step 1: chart test (write, run, fail)** -- render `PlaysByDayChart` with 3 days `[{d1,2},{d2,0},{d3,5}]`: assert 3 `<rect>` elements, the tallest corresponds to d3, each `<rect>` has a `<title>` with its date and count; render with all-zero `byDay` and assert the "No plays in this range." text. Run: `npx vitest run src/components/app/analytics/plays-by-day-chart.test.tsx` -- FAIL.

- [ ] **Step 2: implement `plays-by-day-chart.tsx`** -- pure SVG, `viewBox` sized to the day count, bars keyed by date.

- [ ] **Step 3: run chart test** -- PASS.

- [ ] **Step 4: content table test (write, run, fail)** -- render `ContentPerformanceTable` with 3 rows; assert default order is plays desc; click the "Screens" header and assert the row order changes to sort by `screensReached`; assert `playHours` formatting appears. Run -- FAIL.

- [ ] **Step 5: implement `content-performance-table.tsx`** and `proof-of-play-table.tsx` (the latter is presentational; no dedicated test beyond typecheck, matching how small presentational tables elsewhere are covered by the page-level / e2e tests).

- [ ] **Step 6: run component suite** -- `npx vitest run src/components/app/analytics/` -- PASS.

- [ ] **Step 7: swap the placeholder in `page.tsx`** -- render `<PlaysByDayChart>`, `<ContentPerformanceTable>`, two `<ProofOfPlayTable>` (Campaigns, Schedule rules), and the empty state when `summary.totalPlays === 0` ("No playback reported for this range. Paired players report airings once they are running.").

- [ ] **Step 8: typecheck + lint + component suite** -- `npm run typecheck && npm run lint && npx vitest run src/components/` -- no new errors.

- [ ] **Step 9: Commit** -- `git commit -am "feat: analytics report tables and plays-by-day chart"`

---

## Task 10: `prunePlaybackEvents` worker job

**Files:**
- Create: `src/worker/jobs/prunePlaybackEvents.ts`, `src/worker/jobs/prune.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Produces: `export async function prunePlaybackEvents(now: Date = new Date()): Promise<{ pruned: number }>` -- `prisma.playbackEvent.deleteMany({ where: { airedAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })` where `RETENTION_MS = 90 * 24 * 60 * 60 * 1000`; returns `{ pruned: result.count }`; `logger.info({ pruned }, "pruned playback events")` only when `pruned > 0`. Unscoped across all orgs (mirror `purgeArchivedMedia`). No audit row.
- `src/worker/index.ts`: add `const PRUNE_PLAYBACK_INTERVAL_MS = 3_600_000`, a `let pruningPlayback = false` guard, a `runPrunePlayback()` wrapper matching `runPurgeArchived()`, an import, and a `setInterval(runPrunePlayback, PRUNE_PLAYBACK_INTERVAL_MS)` next to the others.

- [ ] **Step 1: write `prune.test.ts` (run, fail)** -- `resetDb()` + a fixture: 1 org, 1 screen, 3 `PlaybackEvent` rows with `airedAt` at 100 / 89 / 10 days ago. `prunePlaybackEvents(new Date())` returns `{ pruned: 1 }`; the 89- and 10-day rows remain; a second call returns `{ pruned: 0 }`. Add a two-org case: rows in both orgs older than 90 days are both deleted in one pass. Run: `npx vitest run src/worker/jobs/prune.test.ts` -- FAIL.

- [ ] **Step 2: implement `src/worker/jobs/prunePlaybackEvents.ts`**.

- [ ] **Step 3: run prune test** -- PASS.

- [ ] **Step 4: wire `src/worker/index.ts`** -- add the interval / guard / wrapper / import.

- [ ] **Step 5: typecheck** -- `npm run typecheck` -- no new errors.

- [ ] **Step 6: Commit** -- `git commit -am "feat: worker job to prune playback events past retention"`

---

## Task 11: Cross-tenant isolation tests

**Files:**
- Modify: `src/test/isolation/tenant-isolation.spec.ts`

**Interfaces:**
- Consumes: the reporting functions (Tasks 6-7), the ingest route (Task 5), the existing two-org fixture and RLS-backstop pattern.

- [ ] **Step 1: add a fixture** -- in the org-B seed block add `bPlaybackEventId` (a `PlaybackEvent` on a B screen, `airedAt` recent).

- [ ] **Step 2: add cases (write, run, fail then pass)**:
  - acting as org A: `getPlaybackSummary(orgAId, range)` / `getContentPerformance` / `getCampaignProofOfPlay` / `getScheduleProofOfPlay` over a range that covers `bPlaybackEventId` all return zero / empty (never see org B's row).
  - RLS backstop: under `withOrgTransaction(orgAId, tx => tx.$queryRawUnsafe(\`SELECT count(*)::int FROM "PlaybackEvent" WHERE id = '<bId>'\`))` returns `0`.
  - ingest cross-org: authenticate as an org B screen (its device token), `POST` a batch whose `events[0].screenId` is an org A screen id -> 400, `prisma.playbackEvent.count()` unchanged. A batch for the B screen whose `campaignId` is an org A campaign -> the row is inserted with `campaignId: null` (assert), the org A campaign is untouched.
  Run: `npx vitest run src/test/isolation/tenant-isolation.spec.ts` -- FAIL then PASS.

- [ ] **Step 3: full isolation + facade suite** -- `npx vitest run src/test/isolation/ src/lib/db/` -- PASS.

- [ ] **Step 4: Commit** -- `git commit -am "test: tenant isolation for playback events"`

---

## Task 12: e2e, docs, demo script

**Files:**
- Create: `src/test/e2e/analytics.spec.ts`, `scripts/simulate-analytics.ts`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: the running dev server + seeded demo org (`scripts/simulate-*.ts`).

- [ ] **Step 1: `scripts/simulate-analytics.ts`** -- mirror `scripts/simulate-schedule.ts` (idempotent, `--force`, targets "Costa Signage Co"). For each paired, non-offline screen, for each of the last 30 days: resolve the screen's effective content with `resolveScreenContent` (campaigns/schedule already seeded) and the playlist's ready items; synthesize loop iterations for ~10 active hours; emit one `PlaybackEvent` per item per iteration with jittered `durationSeconds` and marching `airedAt`; `id` = a deterministic `\`${screenId}-${dayIndex}-${iter}-${itemIndex}\`` so re-runs are idempotent via `createMany({ skipDuplicates: true })`. Cap total rows near ~20k (slice). `createMany` in chunks of 1000. Print a summary table (events, screens, date span, total play-hours). Run: `npx tsx scripts/simulate-analytics.ts` after `simulate-schedule.ts` -- Expected: rows created, summary printed; a second run adds ~0.

- [ ] **Step 2: e2e spec (write, run)** -- `src/test/e2e/analytics.spec.ts`: register a fresh org (mirror `campaigns.spec.ts` / `schedule.spec.ts`), seed a screen + ~8 `PlaybackEvent` rows via `@/lib/db/root` across 3 days with known totals, sign in, open `/analytics`. Assert the summary tiles show the seeded totals; the content table lists the seeded asset name; the plays-by-day chart renders `<rect>` bars. Change the `from` date input to exclude the oldest day and assert Total plays drops to the expected smaller number. Run: `npm run test:e2e -- analytics` -- PASS.

- [ ] **Step 3: `docs/architecture.md`** -- add an "Analytics" subsection after "Schedule": the `PlaybackEvent` table + the client-supplied-id idempotency; `POST /api/player/events` (batch, dedupe, cross-screen rejection, cross-org id nulling, the `airedAt` window and the `dropped` count); compute-on-read reporting through the facade and why no rollups yet; the four report functions; the `prunePlaybackEvents` 90-day retention job. Update the roadmap line (Analytics now shipped). Update any "tenant tables: N" reference to 34.

- [ ] **Step 4: rebuild dev data if needed** -- if `npm run test` was run at any point, recreate the demo account and re-run every `simulate-*.ts` in order (`account`, `team`, `content`, `media`, `playlists`, `campaigns`, `schedule`, `analytics`, `refresh`).

- [ ] **Step 5: Commit** -- `git commit -am "test: end-to-end analytics journey; docs and demo script"`

---

## Task 13: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: full unit + integration suite** -- with `db:up` + `storage:up`: `npm run test`. Expected: green, count = 472 + the new tests. Investigate any regression.

- [ ] **Step 2: typecheck + lint + build** -- `npm run typecheck && npm run lint && npm run build`. Expected: clean (ignore pre-existing `tsconfig.json` / `simulate-account.ts` noise from a concurrent session).

- [ ] **Step 3: e2e** -- `npm run test:e2e`. Expected: all specs green including `analytics.spec.ts`.

- [ ] **Step 4: manual smoke** -- `npm run dev`; sign in; POST a small batch to `/api/player/events` with a paired screen's device token (curl) and confirm `{ accepted, duplicates, dropped }`; replay it and confirm `duplicates` rises; open `/analytics` and confirm the tiles / tables / chart reflect the seeded + posted events; change the date range and confirm the numbers move.

- [ ] **Step 5: hand off** -- REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch`. Base branch `main`.

---

## Self-Review

**Spec coverage**

- Spec 2 "In scope" 1-10 -> Task 1 (model/migration/RLS/lists/CHECK), Task 5 (ingest route), Task 3 (validation), Tasks 4/6/7 (`src/lib/analytics/*`), Task 2 (RBAC + nav), Tasks 8/9 (page + components), Task 10 (worker), Task 12 (demo), Tasks 3-12 (tests), Task 12 (docs).
- Spec 3.1 ingest flow -> Task 5. Spec 3.2 model -> Task 1. Spec 3.3 reporting: the spec sketches `(db, range)`; the plan's authoritative signature is `(orgId, range)` (Task 6 Interfaces) because the raw-query parts need the transaction client. Same behaviour, RLS-scoped. Spec 3.4 retention -> Task 10. Spec 3.5 no deps -> Global Constraints.
- Spec 4 data model incl. the CHECK, the `@id` with no default, the five indexes, the SetNull/Cascade FKs -> Task 1.
- Spec 5 validation (`playbackEventSchema`, `playbackBatchSchema`, `withinIngestWindow`, the route-level checks) -> Task 3 (schemas + window) + Task 5 (route-level screen-id / resolve-or-null / drop-window).
- Spec 6 route (422/413/400/200 shapes, `skipDuplicates`, scoped reads) -> Task 5.
- Spec 7 RBAC -> Task 2. Spec 8 page + 8.2 components -> Tasks 8-9. Spec 9 demo -> Task 12. Spec 10 testing 10.1-10.7 -> Tasks 3, 4, 5, 6, 7, 10, 11, 12. Spec 11 deliverables -> covered file-by-file. Spec 12 risks -> Global Constraints (`airedAt` window, UTC bucketing accepted, `skipDuplicates` semantics, demo cost cap).

**Placeholder scan** -- `<ts>` is the Prisma-assigned migration timestamp, resolved in Task 1 Step 3. No `TBD`/`TODO`. Every code step has real code or a precise edit description.

**Type consistency** -- `AnalyticsRange` is defined once in Task 6 (`src/lib/analytics/summary.ts` or a shared `types.ts`) and imported by Tasks 7-8. `ProofRow` exported from `proof-of-play.ts` (Task 7) and consumed by `ProofOfPlayTable` (Task 9). The content row shape (`mediaAssetId, assetName, kind, plays, playSeconds, screensReached, lastAiredAt`) is identical in Task 6's `getContentPerformance` return and Task 9's `ContentPerformanceTable` props. `byDay` entries are `{ date: string; plays: number }` in `zeroFillByDay` (Task 4), `getContentPerformance` (Task 6), and `PlaysByDayChart` (Task 9). The ingest response `{ accepted, duplicates, dropped }` is identical in Task 5's route and Task 5's tests. `source` is `"playlist" | "campaign" | "schedule"` in the zod enum (Task 3), the model column (Task 1), and the demo script (Task 12). `PlaybackEvent.id` is client-supplied everywhere (Task 1 schema, Task 5 `createMany`, Task 12 deterministic id).
