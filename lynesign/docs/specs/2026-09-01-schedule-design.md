# Schedule - Design Spec

**Increment:** 7 of the LyneSign rebuild (1 Foundation, 3 Media Library, 4 Playlists + preview, 6 Campaigns, then this; 2 Player runtime and 5 Visual canvas editor were planned but not built).
**Status:** approved for planning.
**Date:** 2026-09-01.

A Schedule rule runs an existing Playlist (or an existing Campaign's playlist) on
a group of screens during a recurring weekly time window: a set of weekdays and a
same-day start/end time, optionally bounded by an effective date range. While a
rule is in its window for a screen it takes over from that screen's base
playlist, but yields to any active Campaign. This increment delivers the model,
targeting, the resolution logic, the player-sync integration, and a per-screen
week-grid authoring UI. It does not deliver midnight-wrapping windows, per-minute
interleaving, sub-poll boundary switching, or schedule analytics.

---

## 1. Context

### What exists today that this builds on

- **Campaigns (increment 6 in the plan numbering, merged at `27aad62`).**
  `Campaign`, `CampaignScreen`, `CampaignLocation` are tenant-scoped, RLS-forced.
  `Campaign.revision` is a monotonic `Int` bumped by `bumpCampaignRevision`
  (`src/lib/campaigns/revision.ts`) as the first statement of every mutating
  transaction. A campaign targets screens directly (`CampaignScreen`) and whole
  locations (`CampaignLocation`, expanded to the location's direct screens).
- **`resolveScreenContent`** (`src/lib/player/campaign.ts`) is pure. Input: the
  screen (`id`, `locationId`, `playlistId`), `now`, and candidate campaigns with
  `screenIds` / `locationIds` already flattened. It picks the winning campaign
  (enabled, not archived, `startsAt <= now < endsAt`, targets the screen) by
  highest `priority`, then earliest `endsAt`, then lowest `id`; falls back to
  `Screen.playlistId`, then `{ source: "none" }`. Output union:
  `{ source: "campaign"; campaignId; campaignName; campaignRevision; campaignEndsAt; playlistId }`
  `| { source: "playlist"; playlistId } | { source: "none" }`.
- **`GET /api/player/sync`** (`src/app/api/player/sync/route.ts`) is device-authed
  (bearer token via `authenticateDevice`). It loads candidate campaigns scoped by
  `organizationId: screen.organizationId`, calls `resolveScreenContent`, then for
  the effective playlist loads its enabled items in `position` order and the
  referenced assets and calls the pure `assembleManifest`
  (`src/lib/player/manifest.ts`). Response:
  `{ screenId, pollIntervalSeconds, source: "campaign" | "playlist" | "none", campaign: {...} | null, playlist: { id, name, revision, items } | null }`.
  Every read in the route carries an explicit `organizationId` because the route
  uses the root `prisma` client.
- **`assemblePlaylistPreview`** (`src/lib/player/preview.ts`) -
  `(db, playlistId) => { id, name, revision, items }`, shared by the playlist and
  campaign preview routes. Throws `NotFoundError` when the playlist is missing.
- **`Screen`** belongs to a `Location` belongs to an `Organization`. `Location`
  has a `parentId` tree and a `timeZone` string (IANA, e.g. `America/New_York`).
  Screens have no tags. `Screen.playlistId` is the base playlist
  (`onDelete: SetNull`); `Screen.pollIntervalSeconds` defaults to 60.
- **Two-layer tenant isolation.** The Prisma `$extends` facade (`forOrg(orgId)` /
  `withOrgTransaction`, `src/lib/db/tenant.ts`) injects `organizationId` and fails
  closed; Postgres `FORCE ROW LEVEL SECURITY` with predicate
  `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`
  (USING + WITH CHECK). The tenant-table list is triplicated and guarded: each
  `*_rls*` / feature migration `ARRAY`, `TENANT_MODELS` (`src/lib/db/tenant.ts`,
  camelCase), `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`, PascalCase);
  `src/lib/db/tenant-model-list.test.ts` asserts all three agree. Today: 30 tenant
  tables. This increment adds 3 -> 33.
- **RBAC** (`src/lib/rbac/policy.ts`) is an `Action` string union plus
  `POLICY: Record<Action, Role[]>`. Groups: `ALL`, `CONTENT_UP`
  (OWNER/ADMIN/MANAGER/CONTENT_MANAGER), `MANAGERS_UP` (OWNER/ADMIN/MANAGER),
  `ADMINS_UP`. `requireRole(action)` (`src/lib/auth/context.ts`) returns
  `ctx = { user, organizationId, role, db, actor }`. `campaign.*` actions:
  view = `ALL`, create/update/delete = `MANAGERS_UP`.
- **Validation** modules live under `src/lib/validation/` (`campaigns.ts`,
  `playlists.ts`, `media.ts`); server actions `safeParse` immediately after
  `requireRole`, work inside `withOrgTransaction`, `writeAudit`, then
  `revalidatePath`; `redirect()` sits outside the try/catch.
- **`deletePlaylist`** (`src/app/(app)/playlists/actions.ts`) already refuses when
  `ctx.db.campaign.count({ where: { playlistId: id } }) > 0` with
  "That playlist is used by a campaign. Remove it from the campaign first."
- **Nav** (`src/lib/nav.ts`) has `{ href: "/schedule", label: "Schedule", ... }`
  pointing at a `ComingSoon` placeholder page at `src/app/(app)/schedule/page.tsx`.
- **No drag-and-drop or date-picker library** is installed. Time input uses the
  native `<input type="time">`; date input uses `<input type="date">`.
- **Timezone helper:** none today. `Intl.DateTimeFormat` with `timeZone` +
  `formatToParts` is the standard-library path and is what this increment uses.

---

## 2. Scope

### In scope

1. `ScheduleRule`, `ScheduleRuleScreen`, `ScheduleRuleLocation` models, one
   migration, RLS, facade + triplicated-list updates (-> 33).
2. `schedule.*` RBAC actions and the nav gate.
3. `src/lib/validation/schedule.ts` zod schemas.
4. `src/lib/schedule/revision.ts` (`bumpScheduleRevision`).
5. A pure `src/lib/player/schedule.ts` with `scheduleRuleMatches` and the
   `zonedNow` derivation helper.
6. `resolveScreenContent` gains a `schedule` tier between campaign and base
   playlist; the `ScreenContent` union gains a `schedule` variant.
7. Server actions: create / update / set-enabled / archive / restore / delete a
   rule; `setScheduleRuleTargets`. Overlap rejection enforced in every mutating
   path.
8. `GET /api/player/sync` evaluates schedule rules in the screen's location
   timezone and reports `source: "schedule"` + a `schedule` object.
9. `deletePlaylist` and `deleteCampaign` refuse when a schedule rule references
   them.
10. `/schedule` UI: per-screen week grid, rule create/edit dialog, campaign
    overlay.
11. Tests: pure, integration, tenant-isolation, e2e; `scripts/simulate-schedule.ts`.

### Out of scope (later increments or never)

- Midnight-wrapping windows (`endMinute <= startMinute`). Overnight coverage is
  two rules.
- Per-rule priority / overlapping rules on one screen. Overlaps are rejected at
  save time.
- Sub-poll boundary switching (a player mid-poll when 17:00 passes shows stale
  content until its next sync, <= `pollIntervalSeconds`).
- Interleaving a schedule playlist with the base playlist.
- Schedule-specific analytics or "what was scheduled when" history (Analytics
  increment).
- Exceptions / one-off overrides ("skip this rule on Dec 25"). A dated rule with
  a narrow effective range is the workaround.

---

## 3. Architecture

### 3.1 Resolution order

Per screen, at an instant `now`:

1. **Active campaign** - unchanged. Highest priority in its `[startsAt, endsAt)`
   window targeting the screen.
2. **Matching schedule rule** - enabled, not archived, `now`'s weekday in
   `daysOfWeek`, `now`'s minute-of-day in `[startMinute, endMinute)`, and `now`'s
   calendar date within `[effectiveFrom, effectiveUntil]` (inclusive, or
   unbounded when null) - all computed in the screen's location timezone. Because
   rules are non-overlapping per screen, at most one matches. Its payload
   resolves to a playlist: `playlistId` directly, or `campaignId` ->
   that campaign's `playlistId` (the campaign row is read for its `id`, `name`,
   `revision` so the player can display and cache-key it).
3. **Base playlist** - `Screen.playlistId`.
4. **Nothing** - `{ source: "none" }`.

### 3.2 Timezone evaluation

The sync route computes, from `screen.location.timeZone` and `now`:

- `zonedWeekday` - `0..6`, `0` = Sunday (matches `Date.prototype.getDay`).
- `zonedMinute` - `0..1439`, minutes since local midnight.
- `zonedDate` - `"YYYY-MM-DD"` local calendar date, compared lexically against
  `effectiveFrom` / `effectiveUntil` rendered the same way.

Derivation uses `Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday, year, month, day, hour, minute }).formatToParts(now)`. This is pure
given `(now, timeZone)` and lives in `src/lib/player/schedule.ts` as
`zonedNow(now, timeZone): { weekday, minute, date }`. An unknown/invalid IANA
zone throws `RangeError` from `Intl`; the route treats a throw as "no schedule
rules match" and logs a warning (a misconfigured location must not break sync).

### 3.3 `scheduleRuleMatches` - `src/lib/player/schedule.ts`

```ts
export type ScheduleRuleCandidate = {
  id: string;
  daysOfWeek: number[];      // 0..6
  startMinute: number;       // 0..1439
  endMinute: number;         // 1..1440, > startMinute
  effectiveFrom: string | null; // "YYYY-MM-DD"
  effectiveUntil: string | null;
};

export function scheduleRuleMatches(
  rule: ScheduleRuleCandidate,
  at: { weekday: number; minute: number; date: string },
): boolean;
```

True iff `rule.daysOfWeek.includes(at.weekday)` and
`at.minute >= rule.startMinute && at.minute < rule.endMinute` and
(`rule.effectiveFrom === null || at.date >= rule.effectiveFrom`) and
(`rule.effectiveUntil === null || at.date <= rule.effectiveUntil`).

The caller pre-filters `enabled === true` and `archivedAt === null` (those are
never in the candidate set) and passes only rules whose targeting includes the
screen. The function does not deduplicate: the non-overlap invariant guarantees
<= 1 match, and a test asserts the route's candidate query plus this filter yield
at most one.

### 3.4 `resolveScreenContent` changes - `src/lib/player/campaign.ts`

`ScreenContent` gains:

```ts
| {
    source: "schedule";
    scheduleRuleId: string;
    scheduleRuleName: string | null;
    scheduleRuleRevision: number;
    playlistId: string;
    campaignId: string | null;         // set when the rule points at a campaign
    campaignName: string | null;
    campaignRevision: number | null;
  }
```

Input gains an optional `schedule?: { ruleId; ruleName; ruleRevision; playlistId; campaignId; campaignName; campaignRevision } | null` - the already-resolved
single matching rule (the route does the DB work of turning `campaignId` into a
`playlistId`). When a campaign wins (step 1) `schedule` is ignored. When no
campaign wins and `schedule` is non-null, return the `schedule` variant. Else the
existing `playlist` / `none` fallback. `resolveScreenContent` stays pure and does
no I/O; the route owns all lookups.

### 3.5 Overlap invariant

For a given organization, no two **enabled, non-archived** `ScheduleRule` rows
may simultaneously (a) resolve to a common screen, (b) share a weekday, (c) have
intersecting `[startMinute, endMinute)` ranges, and (d) have intersecting
effective-date ranges (treating null as -inf / +inf).

Enforced in `assertNoScheduleOverlap(tx, orgId, candidate, excludeRuleId?)`,
called inside every mutating transaction after the row and its targets are
written but before commit (so it sees the new state). Algorithm:

1. Resolve `candidate`'s screen set: direct `screenIds` union the direct screens
   of each target location (`tx.screen.findMany({ where: { locationId: { in } } })`).
2. Load sibling rules: enabled, `archivedAt: null`, `id != excludeRuleId`, whose
   `ScheduleRuleScreen.screenId` is in the set OR whose
   `ScheduleRuleLocation.locationId` is in `candidate`'s location set OR whose
   location targets contain any location owning a screen in the set. Simplest
   correct form: load all enabled non-archived rules for the org with their
   targets, resolve each to a screen set, and compare in memory (rule counts per
   org are small - tens, not thousands; a comment records this and the index that
   keeps the initial fetch cheap).
3. For each sibling sharing >= 1 screen: if `daysOverlap && minutesOverlap && datesOverlap`, throw `ScheduleOverlapError` naming the sibling.

`minutesOverlap(a, b) = a.startMinute < b.endMinute && b.startMinute < a.endMinute`.
`daysOverlap(a, b) = a.daysOfWeek.some(d => b.daysOfWeek.includes(d))`.
`datesOverlap` compares the `"YYYY-MM-DD"` strings with null as open-ended.

`ScheduleOverlapError` maps to a returned `{ error: "This overlaps \"<name>\" on <days> <start>-<end>. Adjust the time, days, or targets." }` - never a thrown 500.

**Known limitation (documented, not fixed here):** moving a screen into a
location after rules exist can create an overlap that was uncheckable at save
time. The player still behaves deterministically because the route's candidate
query plus `scheduleRuleMatches` would then return 2 rows; `resolveScreenContent`
receives `schedule` as the lowest-`id` match and a route-level test asserts the
"pick lowest id, log a warning" tiebreak so a latent overlap degrades to
"deterministic but arbitrary", not a crash.

### 3.6 No new dependencies

`Intl` is built in. Time/date inputs are native. The week grid is CSS grid +
absolute-positioned blocks, no calendar library.

---

## 4. Data model

All three tables carry `organizationId` and get the standard RLS policy via a
hand-appended `DO $$ ... FOREACH t IN ARRAY ARRAY['ScheduleRule','ScheduleRuleScreen','ScheduleRuleLocation'] ...`
block, predicate byte-identical to `20260830032500_rls_empty_guc_is_unscoped`.

### 4.1 `ScheduleRule`

| column | type | notes |
| --- | --- | --- |
| `id` | `String @id @default(cuid())` | |
| `organizationId` | `String` | FK -> `Organization`, `onDelete: Cascade` |
| `name` | `String?` | optional label, <= 120 chars (zod) |
| `playlistId` | `String?` | FK -> `Playlist`, `onDelete: Restrict` |
| `campaignId` | `String?` | FK -> `Campaign`, `onDelete: Restrict` |
| `daysOfWeek` | `Int[]` | non-empty, values `0..6`, unique, `0` = Sunday |
| `startMinute` | `Int` | `0..1439` |
| `endMinute` | `Int` | `1..1440`, DB CHECK `> startMinute` |
| `effectiveFrom` | `DateTime? @db.Date` | calendar date, inclusive; null = open |
| `effectiveUntil` | `DateTime? @db.Date` | calendar date, inclusive; null = open |
| `enabled` | `Boolean @default(true)` | |
| `revision` | `Int @default(1)` | bumped by `bumpScheduleRevision` |
| `createdByUserId` | `String?` | FK -> `User`, `onDelete: SetNull` |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz(3)` | |
| `updatedAt` | `DateTime @updatedAt @db.Timestamptz(3)` | |
| `archivedAt` | `DateTime? @db.Timestamptz(3)` | |

DB CHECK constraints (added in the migration, after `prisma migrate` generates
the table):

- `schedule_rule_payload_xor`: `(("playlistId" IS NOT NULL)::int + ("campaignId" IS NOT NULL)::int) = 1`
- `schedule_rule_minute_bounds`: `"startMinute" >= 0 AND "startMinute" <= 1439 AND "endMinute" >= 1 AND "endMinute" <= 1440 AND "endMinute" > "startMinute"`

Indexes: `@@index([organizationId])`, `@@index([organizationId, enabled, archivedAt])`,
`@@index([playlistId])`, `@@index([campaignId])`.

Relations / back-relations: `organization`, `playlist Playlist?`,
`campaign Campaign?`, `createdBy User?` (relation name `"ScheduleRuleCreator"`),
`screens ScheduleRuleScreen[]`, `locations ScheduleRuleLocation[]`. Add the
matching back-relation fields to `Organization`, `Playlist`, `Campaign`, `User`.

`@db.Date` columns come back from Prisma as `DateTime` at UTC midnight; the
route and UI treat them as plain calendar dates (format with `toISOString().slice(0,10)`, never with a timezone shift). A comment on the model records this.

### 4.2 `ScheduleRuleScreen`

| column | type | notes |
| --- | --- | --- |
| `id` | `String @id @default(cuid())` | |
| `organizationId` | `String` | FK -> `Organization`, `onDelete: Cascade` |
| `scheduleRuleId` | `String` | FK -> `ScheduleRule`, `onDelete: Cascade` |
| `screenId` | `String` | FK -> `Screen`, `onDelete: Cascade` |

`@@unique([scheduleRuleId, screenId])`, `@@index([organizationId])`,
`@@index([screenId])`. Back-relations on `Screen` (`scheduleRuleScreens`) and
`ScheduleRule`.

### 4.3 `ScheduleRuleLocation`

Same shape with `locationId` -> `Location` (`onDelete: Cascade`),
`@@unique([scheduleRuleId, locationId])`, `@@index([organizationId])`,
`@@index([locationId])`. Back-relations on `Location` (`scheduleRuleLocations`)
and `ScheduleRule`.

### 4.4 RLS + facade

- Migration `ARRAY` block as above.
- `TENANT_MODELS` (`src/lib/db/tenant.ts`) gains `"scheduleRule"`,
  `"scheduleRuleScreen"`, `"scheduleRuleLocation"`.
- `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`) gains `"ScheduleRule"`,
  `"ScheduleRuleScreen"`, `"ScheduleRuleLocation"`.
- `src/lib/db/tenant-model-list.test.ts` count assertion 30 -> 33.

---

## 5. Validation - `src/lib/validation/schedule.ts`

- `daysOfWeekSchema` = `z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(unique)`.
- `timeSchema` for a rule = `z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).refine(d => d.endMinute > d.startMinute, "End time must be after start time.")`.
  The UI sends minutes; a `"HH:MM"` -> minutes helper (`parseHHMM`) lives in the
  same module and is unit-tested.
- `createScheduleRuleSchema`: `name` `z.string().trim().max(120).optional()` (empty
  string -> `undefined`); `playlistId` / `campaignId` each `z.string().cuid().optional()`
  with a `.refine` that exactly one is present; `daysOfWeek`; `startMinute` /
  `endMinute` with the refine; `effectiveFrom` / `effectiveUntil` each
  `z.string().date().optional()` with a `.refine` that
  `effectiveUntil >= effectiveFrom` when both are present; `enabled`
  `z.boolean().default(true)`.
- `updateScheduleRuleSchema`: every field optional; the payload-xor refine only
  fires when at least one of `playlistId` / `campaignId` is in the patch, and then
  requires the patch to name exactly one and to null the other; the time refine
  only when both minutes present; the date refine only when both dates present.
- `setScheduleTargetsSchema`: `{ screenIds: z.array(cuid).max(1000), locationIds: z.array(cuid).max(1000) }.refine(at least one non-empty, "Target at least one screen or location.")`.
- `idSchema` = `z.object({ id: z.string().cuid() })`.

---

## 6. Server actions & routes

### `src/app/(app)/schedule/actions.ts`

Every action: `requireRole(...)` -> `safeParse` -> `withOrgTransaction` (first
statement `bumpScheduleRevision(tx, id)` for existing rows, so the `ScheduleRule`
row lock serializes concurrent edits and the overlap check) -> mutate -> targets
-> `assertNoScheduleOverlap` -> `writeAudit` -> `revalidatePath("/schedule")`.
`redirect` (create only) sits outside try/catch.

| action | role | notes |
| --- | --- | --- |
| `createScheduleRule(formData)` | `schedule.create` | creates the row + targets in one tx, runs the overlap check, audits `schedule.create`, `redirect("/schedule?screen=<firstTargetScreenId>")` |
| `updateScheduleRule(id, patch)` | `schedule.update` | bump first; apply patch; if payload keys present, set the winner and null the loser; re-run overlap check; audit `schedule.update` |
| `setScheduleRuleEnabled(id, enabled)` | `schedule.update` | bump; flip `enabled`; when enabling, run overlap check (a disabled rule can be edited into a latent overlap); audit `schedule.setEnabled` |
| `setScheduleRuleTargets(id, { screenIds, locationIds })` | `schedule.assign` | bump first; replace `ScheduleRuleScreen` / `ScheduleRuleLocation` rows; overlap check; audit `schedule.setTargets` |
| `archiveScheduleRule(id)` / `restoreScheduleRule(id)` | `schedule.update` | set / clear `archivedAt`; **no revision bump** (archived rules are filtered out of the candidate query and by `scheduleRuleMatches`' caller, so the effective content simply reverts to campaign/base - same rationale corrected in the campaigns fix wave); restore re-runs the overlap check; audit `schedule.archive` / `schedule.restore` |
| `deleteScheduleRule(id)` | `schedule.delete` | hard delete; cascade removes target rows; no bump; audit `schedule.delete` |

`ScheduleOverlapError` thrown by `assertNoScheduleOverlap` is caught and returned
as `{ error }`; it rolls the transaction back.

### `GET /api/player/sync` changes (`src/app/api/player/sync/route.ts`)

After the campaign resolution and before falling back to the base playlist:

1. Compute `zonedNow(now, screen.location.timeZone)` inside a try; on `RangeError`
   log `warn` and treat as no rules. (The route must now `select` the location's
   `timeZone` - it already loads the screen; extend the select or add a
   `location: { select: { timeZone: true } }`.)
2. `prisma.scheduleRule.findMany` where `organizationId: screen.organizationId`,
   `enabled: true`, `archivedAt: null`, and
   `OR: [{ screens: { some: { screenId: screen.id } } }, { locations: { some: { locationId: screen.locationId } } }]`,
   selecting `id, name, revision, playlistId, campaignId, daysOfWeek, startMinute, endMinute, effectiveFrom, effectiveUntil`.
3. Map rows to `ScheduleRuleCandidate` (dates -> `"YYYY-MM-DD"` via
   `.toISOString().slice(0,10)` or null), keep those where
   `scheduleRuleMatches(candidate, zoned)`.
4. If `matches.length > 1` log `warn({ ruleIds })` and keep the lowest `id`.
5. For the surviving rule: if `campaignId`, load that campaign
   (`id, name, revision, playlistId`, scoped to the org; if missing or its
   playlist is gone, skip the rule - fall through to base) and build the
   `schedule` input with `playlistId` from the campaign; else `playlistId` is the
   rule's own.
6. Pass `schedule` into `resolveScreenContent`.

Response gains, when `resolved.source === "schedule"`:

```jsonc
{
  "source": "schedule",
  "campaign": /* campaignPayload when the rule points at a campaign, else null */,
  "schedule": {
    "id": "...", "name": "..." /* or null */, "revision": 3,
    "playlistId": "...", "campaignId": null
  },
  "playlist": { "id": "...", "name": "...", "revision": N, "items": [ ... ] }
}
```

`playlist` is still the assembled manifest for the effective playlist, built by
the same downstream code path (items -> assets -> `assembleManifest`). The
manifest-building block is refactored to run once on `effectivePlaylistId`
regardless of `source`.

### `deletePlaylist` / `deleteCampaign` guards

- `deletePlaylist` (`src/app/(app)/playlists/actions.ts`): add, next to the
  existing campaign guard,
  `const usedBySchedule = await ctx.db.scheduleRule.count({ where: { playlistId: id } }); if (usedBySchedule > 0) return { error: "That playlist is used by a schedule rule. Remove it from the schedule first." };`
- `deleteCampaign` (`src/app/(app)/campaigns/actions.ts`): add
  `const usedBySchedule = await ctx.db.scheduleRule.count({ where: { campaignId: id } }); if (usedBySchedule > 0) return { error: "That campaign is used by a schedule rule. Remove it from the schedule first." };`
  before the delete. (The FK is `Restrict`, so this turns a DB error into a
  friendly message - same pattern as the playlist/campaign guard.)

---

## 7. RBAC - `src/lib/rbac/policy.ts`

Add actions: `schedule.view` (`ALL`), `schedule.create` / `schedule.update` /
`schedule.delete` / `schedule.assign` (`MANAGERS_UP`). `src/lib/nav.ts`:
`/schedule` entry gains `action: "schedule.view"`. `src/lib/rbac/policy.test.ts`
and `src/lib/nav.test.ts` extended.

---

## 8. UI - `src/app/(app)/schedule/`

### 8.1 `/schedule` - `page.tsx` (replaces `ComingSoon`)

Server component. `requireRole("schedule.view")`. Reads `?screen=<id>`; if absent,
picks the org's first screen ordered by `(location.name, name)`. Loads:

- All screens (`id, name, location: { id, name }`) for the picker, grouped by
  location.
- For the selected screen: every `ScheduleRule` (including archived, for the
  "archived" toggle) whose targeting resolves to it - direct
  `ScheduleRuleScreen` or a `ScheduleRuleLocation` on the screen's location -
  with `playlist: { name }` / `campaign: { name }`.
- Active + upcoming campaigns for the screen (reuse the campaign candidate query,
  no time filter, `archivedAt: null`, `enabled: true`) for the overlay ribbon.
- Playlists and campaigns lists (`id, name`) for the dialog selects.

### 8.2 Week grid - `src/components/app/schedule/schedule-week-grid.tsx`

Client component. CSS grid: a time gutter + 7 day columns (Mon..Sun display
order; data weekday `0` = Sun maps to the last column). Vertical span
06:00-24:00 by default with a "show full 24h" toggle; 30-min row height.

- Each non-archived rule renders one block per weekday it covers, positioned by
  `startMinute` / `endMinute`, labelled with the payload name and time. Disabled
  rules render at reduced opacity with a "paused" tag. Effective-date-bounded
  rules show a small date-range caption.
- Active campaigns render as a thin ribbon pinned to the top of each day column
  they span (date-window only, no time bounds), labelled with the campaign name.
  Non-interactive here - a link jumps to `/campaigns/<id>`.
- Click an empty cell -> open the create dialog prefilled with that weekday and
  the cell's start time (rounded to 30 min), target = the selected screen.
- Click a rule block -> open the edit dialog for that rule.
- Overlap errors returned by actions surface as a toast; the grid refetches via
  `router.refresh()`.

### 8.3 Rule dialog - `src/components/app/schedule/schedule-rule-dialog.tsx`

Client. Fields: `name` (optional text); target mode (radio: "This screen" |
"Choose screens" | "Choose a location") with the matching multi/single select;
payload (radio: "Playlist" | "Campaign") + the corresponding select; weekday
checkboxes (7); start / end `<input type="time">`; optional effective from / until
`<input type="date">`; `enabled` switch. Submit calls `createScheduleRule` /
`updateScheduleRule` then `setScheduleRuleTargets` when targets changed. Delete
and archive/restore buttons in edit mode, gated on `schedule.delete` /
`schedule.update` (pass `canDelete` / `canManage` from the server page, as the
campaign editor does).

### 8.4 Screen picker - `src/components/app/schedule/schedule-screen-picker.tsx`

Client. A `<select>` (or command menu) grouped by location that pushes
`/schedule?screen=<id>`.

---

## 9. Testing

### 9.1 Pure - `src/lib/player/schedule.test.ts`

- `zonedNow`: a fixed `Date` rendered in `America/New_York`, `Asia/Tokyo`,
  `Pacific/Kiritimati` (UTC+14) gives the expected weekday / minute / date,
  including a case where the local date differs from the UTC date; invalid zone
  throws `RangeError`.
- `parseHHMM` / minute formatting round-trips; rejects `"24:01"`, `"9:5"`.
- `scheduleRuleMatches`: weekday hit/miss; `minute === startMinute` true,
  `minute === endMinute` false (half-open); `effectiveFrom` boundary inclusive,
  `effectiveUntil` boundary inclusive, null bounds always pass; a rule failing
  only on date does not match.

### 9.2 Pure - `src/lib/player/campaign.test.ts` (extended)

- Campaign present -> `schedule` input ignored, `source: "campaign"`.
- No campaign, `schedule` non-null with `campaignId: null` -> `source: "schedule"`,
  `playlistId` from the rule, campaign fields null.
- No campaign, `schedule` non-null pointing at a campaign -> `source: "schedule"`,
  `playlistId` from the campaign, `campaignId` / `campaignName` / `campaignRevision`
  populated.
- No campaign, `schedule` null -> existing `playlist` / `none` behaviour unchanged.

### 9.3 Integration - `src/app/(app)/schedule/schedule.test.ts` (real DB, ctx-mock pattern from `campaigns.test.ts`)

- create with a playlist payload; create with a campaign payload; payload-xor
  rejected (both / neither).
- `setScheduleRuleTargets` replaces rows; `updateScheduleRule` bumps `revision`
  as the first statement (assert ordering via a concurrent-edit test mirroring the
  campaigns IMP-1 fix).
- Overlap rejection: same screen + overlapping minutes + shared day -> rejected;
  same screen + adjacent minutes (`endMinute == other.startMinute`) -> allowed;
  same screen + disjoint days -> allowed; disabled sibling -> allowed; effective
  ranges disjoint -> allowed; overlap **via a shared location target** -> rejected;
  overlap where one rule targets the screen directly and another targets its
  location -> rejected.
- `deletePlaylist` / `deleteCampaign` refuse while a rule references them; succeed
  after the rule is deleted.
- archive/restore do not bump `revision`; restore of a rule that would now overlap
  is rejected.

### 9.4 Tenant isolation - `src/test/isolation/tenant-isolation.spec.ts` (extended)

Fixtures `bScheduleRuleId`, `bScheduleRuleScreenId`, `bScheduleRuleLocationId` in
org B. Cross-org attempts for every schedule action return not-found / are
refused; a raw-SQL `SELECT` for org B's rule under org A's GUC returns 0 rows
(RLS backstop).

### 9.5 e2e - `src/test/e2e/schedule.spec.ts`

Sign in, open `/schedule`, pick a screen, create a rule from an empty grid cell
(weekday + time prefilled), see the block render, see it in the edit dialog.
Second rule overlapping the first shows the overlap toast and is not created.

### 9.6 Player route - `src/app/api/player/__tests__` or the existing sync test file

With a rule in-window for a screen, `GET /api/player/sync` returns
`source: "schedule"`, the `schedule` object, and the rule's playlist manifest;
outside the window it returns the base playlist; an active campaign over a
matching rule returns `source: "campaign"`. A rule pointing at a campaign returns
`source: "schedule"` with `campaign` populated.

### 9.7 `scripts/simulate-schedule.ts`

For "Costa Signage Co": a weekday business-hours rule (Mon-Fri 08:00-18:00 ->
"Storefront Loop") and an after-hours rule (Mon-Sun 18:00-23:00 -> "Menu
Rotation") on the storefront screens, plus one location-targeted rule, all
non-overlapping. Matches the `simulate-*.ts` family (idempotent, `--force` to
re-run). Excluded from typecheck by the existing `scripts/simulate-*.ts` glob.

---

## 10. Deliverables

1. `prisma/schema.prisma` + `prisma/migrations/<ts>_schedule/migration.sql`
   (Prisma-generated DDL + CHECK constraints + RLS `DO` block).
2. `prisma/schedule-schema.test.ts` (mirrors `campaigns-schema.test.ts`: asserts
   the CHECK constraints and FK `onDelete` behaviours).
3. `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts`,
   `src/lib/db/tenant-model-list.test.ts` (-> 33).
4. `src/lib/validation/schedule.ts` + `schedule.test.ts`.
5. `src/lib/schedule/revision.ts`.
6. `src/lib/player/schedule.ts` + `schedule.test.ts`;
   `src/lib/player/campaign.ts` + extended `campaign.test.ts`.
7. `src/app/(app)/schedule/actions.ts` + `schedule.test.ts`; `page.tsx`.
8. `src/components/app/schedule/{schedule-week-grid,schedule-rule-dialog,schedule-screen-picker}.tsx` + `.test.tsx`.
9. `src/app/api/player/sync/route.ts` changes + route tests.
10. `src/app/(app)/playlists/actions.ts` + `src/app/(app)/campaigns/actions.ts`
    guard additions + test updates.
11. `src/lib/rbac/policy.ts` + `policy.test.ts`; `src/lib/nav.ts` + `nav.test.ts`.
12. `src/test/isolation/tenant-isolation.spec.ts` extension.
13. `src/test/e2e/schedule.spec.ts`.
14. `scripts/simulate-schedule.ts`.

---

## 11. Risks and open questions

- **Latent overlap from screen moves** (3.5). Accepted: deterministic
  lowest-`id` tiebreak + warning log, documented, not prevented. Revisit if it
  bites.
- **Boundary latency.** A player shows stale content for up to
  `pollIntervalSeconds` (default 60s) after a window opens or closes. Acceptable
  for signage; a `nextBoundaryAt` hint in the sync payload is a clean later
  addition.
- **`@db.Date` timezone traps.** Prisma returns `DateTime` at UTC midnight for
  `@db.Date`; every read/format path must slice the ISO string, never apply a
  local offset. Covered by a comment on the model and by the `zonedNow` tests,
  but a careless `.toLocaleDateString()` somewhere would regress it.
- **In-memory overlap check** loads all enabled rules for the org. Fine at tens
  of rules; if an org ever has thousands, the check needs a SQL pre-filter on
  minute-range and weekday-array overlap.
- **DST.** `Intl` handles the wall-clock conversion correctly, so a rule "09:00"
  is 09:00 local on both sides of a DST change. A window that spans the skipped
  hour (02:00-03:00 in spring-forward) simply doesn't fire that day; not worth
  special-casing.
