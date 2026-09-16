# Campaigns - Design Spec

**Increment:** 6 of the LyneSign rebuild (Foundation, Media Library, Playlists, then this; the Playlist preview player shipped as a follow-up to increment 4).
**Status:** approved for planning.
**Date:** 2026-08-31.

A Campaign runs an existing Playlist across a group of screens for a date window.
While a campaign is active for a screen it takes over from that screen's base
playlist. This increment delivers the model, targeting, the resolution logic, the
player-sync integration, and the authoring UI. It does not deliver interleaved
rotations, day/time recurrence (the Schedule increment), or per-campaign
analytics.

---

## 1. Context

### What exists today that this builds on

- **Playlists (increment 4, merged).** `Playlist` and `PlaylistItem` are
  tenant-scoped, RLS-forced. `Playlist.revision` is a monotonic `Int` bumped by
  `bumpRevision` (`src/lib/playlists/revision.ts`) inside the same transaction as
  every structural change. `Screen.playlistId` is the screen's base playlist
  (`onDelete: SetNull`).
- **`GET /api/player/sync`** (`src/app/api/player/sync/route.ts`) is device-authed
  (bearer token via `authenticateDevice`). It loads the screen's base playlist,
  its enabled items in `position` order, and the referenced assets, then calls
  the pure `assembleManifest` (`src/lib/player/manifest.ts`) to build
  `{ screenId, pollIntervalSeconds, playlist: { id, name, revision, items } | null }`.
  Every read in the route is scoped with an explicit `organizationId:
  screen.organizationId` because the route uses the root `prisma` client.
- **`assembleManifest`** is pure (no I/O): sorted by position, drops disabled
  items and archived / non-`READY` / missing assets, resolves URLs (presigned GET
  3600s for IMAGE/VIDEO, raw `url` for WEB) and durations (item override, then
  playlist default for IMAGE/WEB, then `asset.durationSeconds ?? 0` for VIDEO).
- **`GET /api/playlists/[id]/preview`** (`src/app/api/playlists/[id]/preview/route.ts`)
  is the session-authed twin of sync: `requireRole("playlist.view")`, reads
  through `ctx.db`, returns `{ id, name, revision, items }` from the same
  `assembleManifest`. `PlaylistPreviewDialog`
  (`src/components/app/playlists/playlist-preview-dialog.tsx`) plays it.
- **`Screen`** belongs to a `Location` belongs to an `Organization`. `Location`
  has a `parentId` tree and a `timeZone` string. Screens have no tags.
- **Two-layer tenant isolation.** The Prisma `$extends` facade (`forOrg(orgId)` /
  `withOrgTransaction`, `src/lib/db/tenant.ts`) injects `organizationId` and fails
  closed; Postgres `FORCE ROW LEVEL SECURITY` with the policy predicate
  `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`
  (USING + WITH CHECK). The tenant-table list is triplicated and guarded: the
  `*_rls*` migration `ARRAY`, `TENANT_MODELS` (`src/lib/db/tenant.ts`, camelCase),
  `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`, PascalCase);
  `src/lib/db/tenant-model-list.test.ts` asserts all three agree. Today: 27 tenant
  tables. This increment adds 3 -> 30.
- **RBAC** (`src/lib/rbac/policy.ts`) is an `Action` string union plus
  `POLICY: Record<Action, Role[]>`. Groups: `ALL`, `CONTENT_UP`
  (OWNER/ADMIN/MANAGER/CONTENT_MANAGER), `MANAGERS_UP` (OWNER/ADMIN/MANAGER),
  `ADMINS_UP`. `requireRole(action)` (`src/lib/auth/context.ts`) returns
  `ctx = { user, organizationId, role, db, actor }`.
- **Validation** modules live under `src/lib/validation/` (`playlists.ts`,
  `media.ts`); server actions `safeParse` immediately after `requireRole`.
- **Nav** (`src/lib/nav.ts`) already has `{ href: "/campaigns", label:
  "Campaigns", icon: "campaigns" }`; the page is a `ComingSoon` placeholder.
- **No drag-and-drop or date-picker library** is installed. Datetime input uses
  the native `<input type="datetime-local">`.

---

## 2. Scope

### In scope

1. `Campaign`, `CampaignScreen`, `CampaignLocation` models, one migration, RLS,
   facade + triplicated-list updates (-> 30).
2. `campaign.*` RBAC actions and the nav gate.
3. `src/lib/validation/campaigns.ts` zod schemas.
4. `src/lib/campaigns/revision.ts` (`bumpCampaignRevision`) and a pure
   `resolveScreenContent` (`src/lib/player/campaign.ts`).
5. Server actions: create / update / set-enabled / archive / restore / delete a
   campaign; `setCampaignTargets`.
6. `GET /api/player/sync` picks the effective playlist via `resolveScreenContent`
   and reports `source` + `campaign`.
7. `deletePlaylist` refuses a playlist that a campaign references.
8. `/campaigns` list page (replace `ComingSoon`) and `/campaigns/[id]` editor,
   reusing `PlaylistPreviewDialog`.
9. Tests: unit, integration, cross-tenant isolation, e2e.
10. `docs/architecture.md` "Campaigns" section; a `scripts/simulate-campaigns.ts`
    demo script.

### Out of scope (later increments)

- Interleave and append override modes (v1 is takeover only).
- Day-of-week / time-of-day recurrence, and timezone-aware windows. The Schedule
  increment owns dayparting. v1 windows are absolute UTC instants.
- Location-tree descent (a location target is its direct screens only) and a
  whole-org target.
- Per-campaign playback analytics or proof-of-play.
- A campaign approval / publish workflow. Status is derived; `enabled` is the
  only manual gate.
- Any change to how the device renders content (there is still no device
  renderer; the preview player is the only visual client).

---

## 3. Architecture

### 3.1 Resolution and versioning

The screen's effective content is resolved on demand, every sync poll, by a pure
function. Nothing is precomputed or cached server-side.

- `Campaign.revision` is an `Int` starting at 1. Every server action that mutates
  a campaign or its target sets ends by incrementing `revision` inside the same
  `withOrgTransaction`, via `bumpCampaignRevision(tx, campaignId)` -- the single
  writer. `archiveCampaign` / `restoreCampaign` and `deleteCampaign` do **not**
  bump (an archived campaign simply stops being a candidate; the device notices
  because `source` flips back to `playlist` on the next poll). This mirrors the
  Playlists ruling for `archivePlaylist`.
- `GET /api/player/sync` assembles live: load the screen, load the campaigns that
  could apply to it, call `resolveScreenContent`, then assemble the resulting
  playlist's manifest exactly as the base-playlist path does today.
- The device's change key is the pair `(source, revision)` where `revision` is
  the campaign's when `source === "campaign"` and the playlist's otherwise.
  Because sync recomputes on every poll, a campaign that starts or ends at a
  wall-clock boundary is reflected on the next poll with no write.

### 3.2 `resolveScreenContent` -- `src/lib/player/campaign.ts`

Pure, no I/O, never throws.

```ts
export type ScreenContent =
  | { source: "campaign"; campaignId: string; campaignName: string;
      campaignRevision: number; campaignEndsAt: string; playlistId: string }
  | { source: "playlist"; playlistId: string }
  | { source: "none" };

export function resolveScreenContent(args: {
  screen: { id: string; locationId: string; playlistId: string | null };
  now: Date;
  campaigns: {
    id: string;
    name: string;
    revision: number;
    playlistId: string;
    priority: number;
    startsAt: Date;
    endsAt: Date;
    enabled: boolean;
    archivedAt: Date | null;
    screenIds: string[];   // from CampaignScreen
    locationIds: string[]; // from CampaignLocation
  }[];
}): ScreenContent;
```

Rules:

1. A campaign is a **candidate** for the screen when all hold: `enabled === true`;
   `archivedAt == null`; `startsAt <= now` and `now < endsAt` (half-open, so a
   campaign is done the instant it reaches `endsAt`); and the screen is targeted
   -- `screenIds.includes(screen.id)` **or** `locationIds.includes(screen.locationId)`.
2. If there are candidates, pick the winner by: highest `priority`; ties broken by
   the earliest `endsAt`; then by the campaign `id` (stable, so the function is
   deterministic on identical inputs). Return `{ source: "campaign", ... }` with
   that campaign's `playlistId` and `campaignEndsAt` as an ISO string.
3. Else if `screen.playlistId != null`, return `{ source: "playlist", playlistId }`.
4. Else return `{ source: "none" }`.

The function does not look at playlist health; a campaign that points at an
archived playlist is still resolved (and `assembleManifest` will simply yield an
empty item list if that playlist's items are all unavailable). The editor warns
about an archived target playlist.

### 3.3 No new dependencies

Datetime entry uses `<input type="datetime-local">` (local wall-clock in, stored
as a UTC `DateTime`). No date-picker or timezone library.

---

## 4. Data model

All three new models are tenant-scoped and RLS-forced. Add them to the `*_rls*`
`ARRAY`, `TENANT_MODELS` (`"campaign"`, `"campaignScreen"`, `"campaignLocation"`),
and `TENANT_TABLES` (`"Campaign"`, `"CampaignScreen"`, `"CampaignLocation"`) --
all three lists reach 30; `tenant-model-list.test.ts` must stay green.

### 4.1 `Campaign`

```prisma
model Campaign {
  id              String   @id @default(cuid())
  organizationId  String
  name            String
  description     String?
  playlistId      String
  startsAt        DateTime @db.Timestamptz(3)
  endsAt          DateTime @db.Timestamptz(3)
  priority        Int      @default(0)
  enabled         Boolean  @default(true)
  revision        Int      @default(1)
  createdByUserId String?
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)
  archivedAt      DateTime? @db.Timestamptz(3)

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  playlist     Playlist           @relation(fields: [playlistId], references: [id], onDelete: Restrict)
  createdBy    User?              @relation("CampaignCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  screens      CampaignScreen[]
  locations    CampaignLocation[]

  @@index([organizationId])
  @@index([organizationId, archivedAt])
  @@index([organizationId, enabled, startsAt, endsAt])
  @@index([playlistId])
}
```

- `playlist` is `onDelete: Restrict` -- a playlist a campaign uses cannot be hard
  deleted (see section 8). No DB uniqueness on `name`. `priority` has no DB bound;
  the zod schema caps it at 0..1000.
- The `enabled/startsAt/endsAt` composite index supports the "candidates for a
  screen right now" query.

### 4.2 `CampaignScreen`

```prisma
model CampaignScreen {
  id             String   @id @default(cuid())
  organizationId String
  campaignId     String
  screenId       String

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  campaign     Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  screen       Screen       @relation(fields: [screenId], references: [id], onDelete: Cascade)

  @@unique([campaignId, screenId])
  @@index([organizationId])
  @@index([screenId])
}
```

### 4.3 `CampaignLocation`

```prisma
model CampaignLocation {
  id             String   @id @default(cuid())
  organizationId String
  campaignId     String
  locationId     String

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  campaign     Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  location     Location     @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@unique([campaignId, locationId])
  @@index([organizationId])
  @@index([locationId])
}
```

Back-relations: `Playlist.campaigns Campaign[]`, `Screen.campaignScreens
CampaignScreen[]`, `Location.campaignLocations CampaignLocation[]`,
`Organization.campaigns` / `campaignScreens` / `campaignLocations`,
`User.createdCampaigns Campaign[] @relation("CampaignCreator")`.

### 4.4 RLS + facade

- Migration `<timestamp>_campaigns`: create the three tables + all FKs with the
  `onDelete` actions above, then a hand-appended `DO $$ ... FOREACH t IN ARRAY
  ARRAY['Campaign','CampaignScreen','CampaignLocation'] LOOP` block that runs
  `ENABLE` + `FORCE ROW LEVEL SECURITY` and `CREATE POLICY tenant_isolation` with
  the predicate byte-identical to migration
  `20260830032500_rls_empty_guc_is_unscoped` (USING + WITH CHECK). Match the
  exact style of the block in `20260831055827_playlists/migration.sql`.
- The migration applies cleanly on top of the existing migrations and from an
  empty database (verify against a throwaway DB; `prisma migrate reset` is
  blocked for agents).

---

## 5. Validation -- `src/lib/validation/campaigns.ts`

```
idSchema             z.string().min(1)

createCampaignSchema z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  playlistId: z.string().min(1),
  startsAt: z.string().datetime(),            // ISO 8601, from the client
  endsAt: z.string().datetime(),
  priority: z.number().int().min(0).max(1000).optional(),
}).refine(v => new Date(v.endsAt) > new Date(v.startsAt),
  { message: "The end must be after the start.", path: ["endsAt"] })

updateCampaignSchema z.object({
  name: ...optional, description: ...nullable().optional(),
  playlistId: z.string().min(1).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
}).refine(when both startsAt and endsAt are present, endsAt > startsAt)
// updateCampaign additionally re-checks the effective window against the
// stored row when only one of the two is supplied (in the action, not zod).

setTargetsSchema     z.object({
  screenIds: z.array(z.string().min(1)).max(1000),
  locationIds: z.array(z.string().min(1)).max(1000),
}).refine(v => v.screenIds.length + v.locationIds.length > 0,
  { message: "Choose at least one screen or location." })
```

All messages terse, ending in a period, no em dashes / emojis / exclamation
points.

---

## 6. Server actions & routes

All in `src/app/(app)/campaigns/actions.ts`, all `"use server"`, all:
`requireRole(<action>)` first, then `safeParse`, then work inside
`withOrgTransaction`, then `bumpCampaignRevision` where the campaign or its
targets changed, then `writeAudit(...)`, then `revalidatePath`. `redirect()` (if
any) stays outside try/catch. Every caller-supplied id (playlist, screen,
location) is resolved through `ctx.db` so a cross-org id reads as absent.

| Action | Role | Behavior |
|---|---|---|
| `createCampaign(input)` | `campaign.create` | `createCampaignSchema`. `playlistId` must resolve via `ctx.db.playlist.findUnique` and be non-archived (else `{ error: "Choose a playlist from your organization." }`). Create with `organizationId`, `createdByUserId: ctx.user.id`, `priority: input.priority ?? 0`, `revision: 1`. Audit `campaign.create`. Returns `{ id }` or `{ error }`. |
| `updateCampaign(id, patch)` | `campaign.update` | `idSchema` + `updateCampaignSchema`. Campaign resolves via `ctx.db` else `NotFoundError`. If `playlistId` in patch, it must resolve + be non-archived. Compute the effective window (patch value or stored) and reject unless `endsAt > startsAt` with `{ error: "The end must be after the start." }`. Update inside the tx, then `bumpCampaignRevision`. Audit `campaign.update`. `revalidatePath("/campaigns")` and `/campaigns/${id}`. |
| `setCampaignEnabled(id, enabled)` | `campaign.update` | `z.boolean()` guard. Resolve via `ctx.db`. Update `enabled`, `bumpCampaignRevision`. Audit `campaign.enabled`. |
| `archiveCampaign(id)` | `campaign.delete` | Resolve; set `archivedAt = new Date()`. **No revision bump.** Audit `campaign.archive`. Revalidate both paths. |
| `restoreCampaign(id)` | `campaign.update` | Resolve; clear `archivedAt`. **No revision bump.** Audit `campaign.restore`. |
| `deleteCampaign(id)` | `campaign.delete` | Resolve; `ctx.db.campaign.delete` (cascades `CampaignScreen` / `CampaignLocation`). Audit `campaign.delete`. `revalidatePath("/campaigns")`. |
| `setCampaignTargets(id, { screenIds, locationIds })` | `campaign.update` | `idSchema` + `setTargetsSchema`. Campaign resolves via `ctx.db`. Every `screenId` must resolve via `ctx.db.screen.findMany({ where: { id: { in } } })` (count matches) and likewise `locationId` via `ctx.db.location`; any miss -> `{ error: "One of those targets is not in your organization." }`, no writes. Inside the tx: `deleteMany` the campaign's `CampaignScreen` rows whose `screenId` is not in the new set and `createMany` the new ones; same for `CampaignLocation`. Then `bumpCampaignRevision`. Audit `campaign.targets` with `{ screens: screenIds.length, locations: locationIds.length }`. |

### `GET /api/player/sync` changes (`src/app/api/player/sync/route.ts`)

After `authenticateDevice` + the existing `player.sync` actor check, and keeping
every read scoped with `organizationId: screen.organizationId`:

1. Load candidate campaigns in one query:
   ```
   prisma.campaign.findMany({
     where: {
       organizationId: screen.organizationId,
       enabled: true,
       archivedAt: null,
       startsAt: { lte: now },
       endsAt: { gt: now },
       OR: [
         { screens:   { some: { screenId: screen.id } } },
         { locations: { some: { locationId: screen.locationId } } },
       ],
     },
     select: {
       id: true, name: true, revision: true, playlistId: true, priority: true,
       startsAt: true, endsAt: true, enabled: true, archivedAt: true,
       screens:   { select: { screenId: true } },
       locations: { select: { locationId: true } },
     },
   })
   ```
2. `resolveScreenContent({ screen: { id, locationId, playlistId: screen.playlistId }, now, campaigns: <mapped> })`.
3. Take the resolved `playlistId` (from `source: "campaign"` or `"playlist"`); if
   `source === "none"` skip to the null response.
4. Load that playlist + its enabled items + assets and call `assembleManifest`
   exactly as the route does today (this block is unchanged apart from the id it
   starts from). A resolved playlist that no longer exists (race) -> null response.
5. Response:
   ```json
   {
     "screenId": "...",
     "pollIntervalSeconds": 60,
     "source": "campaign",
     "campaign": { "id": "...", "name": "...", "revision": 4, "endsAt": "2026-09-15T00:00:00.000Z" },
     "playlist": { "id": "...", "name": "...", "revision": 7, "items": [ ... ] }
   }
   ```
   - `source` is always present: `"campaign"`, `"playlist"`, or `"none"`.
   - `campaign` is the campaign object when `source === "campaign"`, else `null`.
   - `playlist` is the effective playlist's manifest, or `null` when `source ===
     "none"` (or the effective playlist vanished).
   - `canvas` and a top-level `manifest` key remain absent (removed in increment 4).

### `GET /api/campaigns/[id]/preview` (`src/app/api/campaigns/[id]/preview/route.ts`)

Thin wrapper so the editor can reuse `PlaylistPreviewDialog`: `requireRole(
"campaign.view")`, resolve the campaign via `ctx.db`, then delegate to the exact
same assembly the playlist preview route uses on `campaign.playlistId`, returning
the identical `{ id, name, revision, items }` shape (the playlist's id/name/
revision). Reuse a shared helper if the playlist preview route's body is factored
out; otherwise duplicate the ~30 lines and note it.

---

## 7. RBAC -- `src/lib/rbac/policy.ts`

| Action | Group |
|---|---|
| `campaign.view` | `ALL` |
| `campaign.create` | `MANAGERS_UP` |
| `campaign.update` | `MANAGERS_UP` |
| `campaign.delete` | `MANAGERS_UP` |

`src/lib/nav.ts`: the `/campaigns` item gets `action: "campaign.view"`.
`can.test.ts` / `nav.test.ts` updated for the new rows.

---

## 8. `deletePlaylist` guard

`deletePlaylist` (`src/app/(app)/playlists/actions.ts`) currently hard-deletes.
`Campaign.playlistId` is `onDelete: Restrict`, so a delete of a referenced
playlist throws a foreign-key error. Add a guard before the delete:
`const used = await ctx.db.campaign.count({ where: { playlistId: id } });` and if
`used > 0` return `{ error: "That playlist is used by a campaign. Remove it from
the campaign first." }`. Update the playlists action test with a case:
`deletePlaylist` on a campaign-referenced playlist -> `{ error }`, row still
present.

---

## 9. UI -- `src/app/(app)/campaigns/`

Server components load through `ctx.db`; every function / event handler lives in a
`"use client"` child (no render-closure props across the RSC boundary). No
bigints. Datetimes are passed to client components as ISO strings and rendered
with `date-fns`; the editor's inputs are `datetime-local` and convert to/from ISO
on the client.

### 9.1 `/campaigns` -- list (`page.tsx`, replaces `ComingSoon`)

- `requireRole("campaign.view")`. One `withOrgTransaction`:
  `campaign.findMany({ where: { archivedAt: null }, orderBy: [{ startsAt: "asc" }], include: { playlist: { select: { name: true } }, _count: { select: { screens: true, locations: true } } } })`.
- For each row compute a status label from `enabled` + now vs `[startsAt,
  endsAt)`: `Paused` (not enabled), else `Scheduled` (now < startsAt), `Active`
  (in window), `Ended` (now >= endsAt). Compute server-side and pass as a string.
- Render `<PageHeader title="Campaigns" actions={canCreate ? <NewCampaignDialog playlists={...} /> : null}>` + `<CampaignList rows={rows} />`. Each row: name, playlist name, the window (`d MMM - d MMM`), status badge, `{screens + locations targeted}` summary, priority. Links to `/campaigns/[id]`.
- `<EmptyState>` when there are none.

### 9.2 `/campaigns/[id]` -- editor (`[id]/page.tsx` + client components)

- `requireRole("campaign.view")`; `notFound()` if the campaign is not in the org.
- One `withOrgTransaction`: the campaign (all scalar fields + `playlist: { id, name, archivedAt }`), its `CampaignScreen.screenId` and `CampaignLocation.locationId` sets, the org's non-archived playlists (`id, name`), and the org's screens (`id, name, locationId, location: { name }`) and locations (`id, name`).
- `canUpdate = can(ctx.actor, "campaign.update")`, `canDelete = can(ctx.actor, "campaign.delete")`.
- Render `<CampaignEditor ...serializable... canUpdate canDelete />`. Components under `src/components/app/campaigns/`:
  - `campaign-editor.tsx` (`"use client"`) -- owns the fields form (name, description, playlist select, start/end `datetime-local`, priority, enable toggle) calling `updateCampaign` / `setCampaignEnabled` on change or an explicit Save; a "Preview" button opening `PlaylistPreviewDialog` pointed at `/api/campaigns/${id}/preview`; a computed "This campaign currently affects N screens" line (union of directly targeted screens and screens whose `locationId` is targeted); a delete control (confirm dialog -> `deleteCampaign` -> `router.push("/campaigns")`) when `canDelete`; an "archived" banner when applicable. If the target playlist is archived, show a warning.
  - `campaign-targets-panel.tsx` (`"use client"`) -- the org's locations, each a checkbox (whole-location target) with its screens nested beneath as individual checkboxes. Toggling any checkbox recomputes the `{ screenIds, locationIds }` sets and calls `setCampaignTargets(id, sets)` then `router.refresh()`. A screen whose location is checked shows as covered (checkbox checked + disabled, with a "via location" hint). Disabled entirely when `!canUpdate`.
  - `new-campaign-dialog.tsx` (`"use client"`) -- name, playlist select, start/end, priority; `createCampaign` -> on `{ id }` `router.push(\`/campaigns/${id}\`)`.
- `PlaylistPreviewDialog` gets an optional prop for the fetch path (default
  `/api/playlists/${id}/preview`) so the campaign editor can point it at
  `/api/campaigns/${id}/preview` without a new component.

---

## 10. Testing

- **Unit** (`src/lib/player/campaign.test.ts`): `resolveScreenContent` --
  no campaigns -> `{ source: "playlist" }` (or `"none"` when the screen has no
  base playlist); one active screen-targeted campaign -> `{ source: "campaign" }`;
  one active location-targeted campaign (screen's `locationId` matches) -> ditto;
  a campaign that targets neither -> ignored; `enabled: false` / `archivedAt` set
  -> ignored; `now === startsAt` -> candidate, `now === endsAt` -> not a candidate
  (half-open); priority ordering; tie on priority -> earlier `endsAt` wins; tie on
  both -> lower `id` wins (deterministic); the winner's `playlistId` and
  `campaignEndsAt` (ISO) are returned.
- **Unit** (`src/lib/validation/campaigns.test.ts`): `endsAt <= startsAt`
  rejected; blank name; over-long description; `priority` `-1` / `1001`; bad ISO
  datetime; `setTargetsSchema` with both arrays empty rejected; oversized arrays
  rejected.
- **Integration** (`src/app/(app)/campaigns/campaigns.test.ts`, real DB): create
  with a valid + an archived playlist; `updateCampaign` bumps `revision` and the
  one-sided-window re-check; `setCampaignEnabled` bumps; `archiveCampaign` does
  NOT bump and drops it from candidacy; `deleteCampaign` cascades the join rows;
  `setCampaignTargets` replaces both sets and rejects a cross-org screen or
  location id; a cross-org `playlistId` in `createCampaign` is rejected.
- **Integration** (`src/app/api/player/sync/*`): a screen with a base playlist and
  (a) no campaign -> `source: "playlist"`; (b) an active screen-targeted campaign
  -> `source: "campaign"`, `campaign` populated, `playlist` is the campaign's
  playlist manifest; (c) two overlapping active campaigns -> the higher-priority
  one wins; (d) a campaign whose window has passed -> ignored; (e) a
  location-targeted campaign matching the screen's location -> wins; the
  `canvas` / top-level `manifest` keys stay absent.
- **Integration** (`src/app/api/campaigns/[id]/preview/*`): returns the campaign's
  playlist manifest; 404 for another org's campaign.
- **Isolation** (`src/test/isolation/tenant-isolation.spec.ts`): with org B owning
  a campaign + a `CampaignScreen` + a `CampaignLocation`: `forOrg(A)` never sees
  B's `Campaign` / `CampaignScreen` / `CampaignLocation`; every campaign action
  called with a B id returns `{ error }` / throws and leaves B's rows unchanged;
  `setCampaignTargets` with B's screen or location id is rejected;
  `withOrgTransaction(A, raw SELECT)` returns none of B's campaign rows.
- **e2e** (`src/test/e2e/campaigns.spec.ts`): register -> seed 2 playlists and a
  couple of screens/locations directly -> create a campaign via the UI with a
  window that is active now -> target one screen -> pair that screen and hit
  `GET /api/player/sync` -> assert `source: "campaign"` and the campaign's
  playlist items; then set the campaign window to the past via the UI, poll sync
  again -> assert `source: "playlist"` (the base playlist).
- Full `npm run test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`
  green. CI already brings up MinIO.

**Known limitation (documented, not fixed here):** a screen only re-resolves its
content when it next polls sync, so a campaign boundary takes effect up to one
`pollIntervalSeconds` late. This is inherent to a poll-based player and is
acceptable; a push channel is a much later concern.

---

## 11. Deliverables

- `prisma/schema.prisma` -- `Campaign`, `CampaignScreen`, `CampaignLocation`,
  back-relations on `Playlist` / `Screen` / `Location` / `Organization` / `User`.
- `prisma/migrations/<ts>_campaigns/migration.sql` -- tables, FKs, RLS block.
- `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts` -- list updates (30).
- `src/lib/rbac/policy.ts`, `src/lib/nav.ts` -- `campaign.*` + nav gate.
- `src/lib/validation/campaigns.ts`.
- `src/lib/campaigns/revision.ts` (`bumpCampaignRevision`).
- `src/lib/player/campaign.ts` (`resolveScreenContent`, `ScreenContent`).
- `src/app/(app)/campaigns/actions.ts`.
- `src/app/(app)/campaigns/page.tsx`, `src/app/(app)/campaigns/[id]/page.tsx`.
- `src/components/app/campaigns/{campaign-list,new-campaign-dialog,campaign-editor,campaign-targets-panel}.tsx`.
- `src/app/api/player/sync/route.ts` -- campaign resolution.
- `src/app/api/campaigns/[id]/preview/route.ts`.
- `src/components/app/playlists/playlist-preview-dialog.tsx` -- optional fetch-path prop.
- `src/app/(app)/playlists/actions.ts` -- `deletePlaylist` campaign guard.
- Tests as in section 10.
- `docs/architecture.md` -- a "Campaigns" section (the three models, the resolution
  rule, the sync `source` field, the poll-latency limitation); roadmap list updated.
- `scripts/simulate-campaigns.ts` -- a demo script matching the `simulate-*.ts`
  family: for "Costa Signage Co", one active campaign ("Fall Sale") pointing at an
  existing playlist, targeting a location, priority 10; one scheduled-for-next-week
  campaign. Excluded from typecheck by the existing `scripts/simulate-*.ts` glob.

---

## 12. Risks and open questions

- **Half-open window and clock skew.** `now < endsAt` means a campaign ends
  exactly at `endsAt`; a device with a skewed clock is irrelevant because the
  server computes the window using its own `now` on each sync. No action.
- **Overlapping campaigns with equal priority and equal `endsAt`.** The `id`
  tie-break keeps resolution deterministic but arbitrary. The editor surfaces
  active overlaps so an operator can set distinct priorities. Acceptable.
- **A campaign pointing at an archived playlist** resolves and then assembles to
  an empty manifest. The editor warns; sync still reports `source: "campaign"`
  with an empty `playlist.items`. A future refinement could skip such a campaign
  and fall through to the next candidate; out of scope now.
- **`setCampaignTargets` at 1000 + 1000 ids** is two `findMany` id checks plus a
  `deleteMany` + `createMany` per set, inside one transaction. Comfortable. The
  UI will not realistically produce lists that large.
- **Location-tree descent** is deliberately absent: targeting a parent location
  does not pull in child-location screens. If operators expect it, it is a small
  follow-up (expand `locationIds` through the `Location` tree in
  `resolveScreenContent`'s caller, not the pure function).
