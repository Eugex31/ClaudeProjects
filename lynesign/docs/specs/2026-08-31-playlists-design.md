# Playlists — Design Spec

**Increment:** 4 of the LyneSign rebuild (Foundation, Media Library, then this).
**Status:** approved for planning.
**Date:** 2026-08-31.

A Playlist is an ordered, looping sequence of media library assets that a screen
plays. This increment delivers the authoring model and UI, screen assignment, and
a real player-sync manifest. It does not deliver scheduling, campaigns, or a
device-side renderer.

---

## 1. Context

### What exists today that this builds on

- **Media Library (increment 3, merged).** `MediaAsset` rows are `IMAGE` / `VIDEO`
  / `WEB`, tenant-scoped, RLS-forced. An asset has `status` (`UPLOADING` /
  `READY` / `FAILED`), `archivedAt`, `storageKey`, `thumbnailKey`, `mimeType`,
  `width`, `height`, `durationSeconds` (nullable; set for video when ffprobe is
  available), and `url` (set only for `WEB`). Objects live in S3/MinIO; the app
  mints presigned GET URLs with `storage.createDownloadUrl(key, ttlSeconds)`.
- **`MediaAsset` delete safety.** Hard delete is `onDelete: Restrict` from
  `Picture` / `Video`; the library only soft-deletes (`archivedAt`). The
  `purgeArchivedMedia` worker hard-deletes an archived asset only when no
  `Picture` / `Video` references it.
- **Screens.** `Screen` belongs to a `Location` belongs to an `Organization`. It
  has `canvasId` (legacy Display Monkey `Canvas`, imported only) and
  `pollIntervalSeconds`. Screens pair for a device token
  (`POST /api/player/pair`), then poll `GET /api/player/heartbeat` and
  `GET /api/player/sync`.
- **`GET /api/player/sync`** currently returns a stub:
  `{ screenId, pollIntervalSeconds, canvas: null, manifest: [] }`. It resolves
  the screen from its bearer device token (`authenticateDevice`) and checks a
  `screen` actor against `player.sync` (whose policy row is `[]` — deny-all —
  because no screen-actor action is allowed yet; `player.sync` is enforced at the
  route by device auth, not RBAC).
- **Two-layer tenant isolation.** (1) the Prisma `$extends` facade
  (`forOrg(orgId)` / `withOrgTransaction`, `src/lib/db/tenant.ts`) injects
  `organizationId` and fails closed; (2) Postgres `FORCE ROW LEVEL SECURITY`
  with policy predicate
  `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`
  (USING + WITH CHECK). The tenant-table list is triplicated and guarded:
  the `*_rls*` migration `ARRAY[...]`, `TENANT_MODELS` in `src/lib/db/tenant.ts`,
  `TENANT_TABLES` in `src/test/isolation/tenant-tables.ts`;
  `src/lib/db/tenant-model-list.test.ts` asserts all three agree. Today: 25
  tenant tables. This increment adds 2 → 27.
- **RBAC.** `src/lib/rbac/policy.ts` — an `Action` string union plus
  `POLICY: Record<Action, Role[]>`. Role groups: `ALL`, `CONTENT_UP`
  (OWNER/ADMIN/MANAGER/CONTENT_MANAGER), `MANAGERS_UP` (OWNER/ADMIN/MANAGER),
  `ADMINS_UP`. `requireRole(action)` (`src/lib/auth/context.ts`) returns
  `ctx = { user, organizationId, role, db, actor }`.
- **Validation.** Per-feature zod modules under `src/lib/validation/`
  (e.g. `media.ts`). Server actions `safeParse` immediately after `requireRole`.
- **Nav.** `src/lib/nav.ts` already has
  `{ href: "/playlists", label: "Playlists", icon: "playlists" }`; the page is a
  `ComingSoon` placeholder.
- **No drag-and-drop library** is installed.

---

## 2. Scope

### In scope

1. `Playlist` and `PlaylistItem` models, migration, RLS, facade + triplicated-list
   updates.
2. `playlist.*` RBAC actions and the nav gate.
3. `src/lib/validation/playlists.ts` zod schemas.
4. Server actions: create / rename / update-defaults / archive / restore a
   playlist; add items (from the library, batch); remove an item; reorder items;
   set a per-item duration override; enable/disable an item; assign / unassign a
   playlist to a screen.
5. `Screen.playlistId` column + relation; a `Playlist` select on the screen form.
6. A pure manifest-assembly function and the wiring of `GET /api/player/sync` to
   return the real manifest.
7. `/playlists` list page (replace `ComingSoon`) and `/playlists/[id]` editor.
8. Tests: unit, integration, cross-tenant isolation, e2e.
9. `purgeArchivedMedia` worker: also refuse to purge an asset referenced by a
   `PlaylistItem`.

### Out of scope (later increments)

- Scheduling — day/time windows, recurrence (`schedule` nav item, increment 5).
- Campaigns — one playlist across many screens / locations with precedence
  (increment 6).
- Draft / published playlist states. Edits are live on the next screen poll.
- Transitions beyond a hard cut; shuffle / randomized order.
- The device-side renderer / player app.
- Per-item time or location scoping (legacy `FrameLocation` behavior).
- Bringing legacy `Canvas` / `Panel` / `Frame` into a playlist.

---

## 3. Architecture

### 3.1 Assembly and versioning

On-demand assembly with an explicit monotonic version:

- `Playlist.revision` is an `Int` starting at 1. **Every** server action that
  mutates a playlist or any of its items ends by incrementing `revision` inside
  the same `withOrgTransaction`. A shared helper `bumpRevision(tx, playlistId)`
  is the single writer.
- `GET /api/player/sync` assembles the manifest live on every request: load the
  screen's playlist and its `enabled` items ordered by `position`, join the
  `MediaAsset` rows, drop any whose asset is missing / `archivedAt` set /
  `status != "READY"`, resolve each item's URL and duration, return the list plus
  `revision`.
- The device compares `revision` between polls to decide whether the item list or
  order changed. It is a hint for cache invalidation, not a strict cache key:
  sync always returns a freshly filtered list, and the device must still tolerate
  a media URL that 404s (asset deleted out from under a stale manifest). A
  content-hash that also captures asset edits is a later refinement, noted in
  §11.

Rationale: no snapshot table to keep in sync with asset changes; presigned URLs
are always fresh; `revision` gives the device trivial integer change detection.
Assembling on demand costs one indexed query for items, one `findMany` for the
assets, and N local-HMAC presign calls — all cheap.

### 3.2 Item ordering

`PlaylistItem.position` is a 0-based contiguous `Int`. There is **no**
`@@unique([playlistId, position])` — a bulk reorder would hit transient
collisions. Instead:

- Every mutating action rewrites a valid `0..n-1` permutation for the whole
  playlist inside one transaction (add appends at `n`; remove deletes then
  compacts; reorder rewrites from a client-supplied id order after validating
  the id set matches the playlist's items exactly).
- `@@index([playlistId, position])` supports the ordered read.
- A test asserts positions are exactly `0..n-1` after each of add / remove /
  reorder.

### 3.3 No new dependencies

Reorder UI is up/down buttons (the tested, accessible path) plus an optional
native HTML5 drag handle. No `@dnd-kit` or similar.

---

## 4. Data model

Both new models are tenant-scoped and RLS-forced. Add them to the `*_rls*`
`ARRAY`, `TENANT_MODELS`, and `TENANT_TABLES` (→ 27 each);
`tenant-model-list.test.ts` must stay green.

### 4.1 `Playlist`

```prisma
model Playlist {
  id                          String   @id @default(cuid())
  organizationId              String
  name                        String
  description                 String?
  defaultImageDurationSeconds Int      @default(10)
  defaultWebDurationSeconds   Int      @default(30)
  revision                    Int      @default(1)
  createdByUserId             String?
  createdAt                   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt                   DateTime @updatedAt @db.Timestamptz(3)
  archivedAt                  DateTime? @db.Timestamptz(3)

  organization Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User?          @relation("PlaylistCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  items        PlaylistItem[]
  screens      Screen[]

  @@index([organizationId])
  @@index([organizationId, archivedAt])
}
```

- No DB uniqueness on `name` (duplicate playlist names are allowed).
- Archiving a playlist does not detach it from screens; assembly of an archived
  playlist still works, but the editor and the screen-form select hide archived
  playlists. `restorePlaylist` clears `archivedAt`.

### 4.2 `PlaylistItem`

```prisma
model PlaylistItem {
  id              String   @id @default(cuid())
  organizationId  String
  playlistId      String
  mediaAssetId    String
  position        Int
  durationSeconds Int?
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  playlist     Playlist     @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  mediaAsset   MediaAsset   @relation(fields: [mediaAssetId], references: [id], onDelete: Restrict)

  @@index([playlistId, position])
  @@index([organizationId])
  @@index([mediaAssetId])
}
```

- `onDelete: Restrict` on `mediaAsset` — an asset in any playlist cannot be hard
  deleted. The library already only soft-deletes; §8 fixes the purge worker so it
  does not trip this.
- Deleting a playlist cascades its items.
- The same asset may appear in a playlist more than once (no uniqueness on
  `[playlistId, mediaAssetId]`); each occurrence is its own item with its own
  duration.
- `MediaAsset` gains a back-relation `playlistItems PlaylistItem[]`.

### 4.3 `Screen.playlistId`

```prisma
// on model Screen
playlistId String?
playlist   Playlist? @relation(fields: [playlistId], references: [id], onDelete: SetNull)
// + @@index([playlistId])
```

`canvasId` is unchanged. If both are set, sync uses `playlistId` and ignores
`canvasId`. Deleting a playlist nulls `playlistId` on its screens (those screens
then sync an empty payload until reassigned).

### 4.4 RLS + facade

- Migration `<timestamp>_playlists`: create the two tables, add
  `Screen.playlistId` + FK + index, then a hand-appended `DO $$ ... FOREACH t IN
  ARRAY ARRAY['Playlist','PlaylistItem'] LOOP` block that runs `ENABLE` + `FORCE
  ROW LEVEL SECURITY` and `CREATE POLICY tenant_isolation` with the predicate
  byte-identical to migration `20260830032500_rls_empty_guc_is_unscoped`
  (USING and WITH CHECK).
- `TENANT_MODELS` (`src/lib/db/tenant.ts`) += `"playlist"`, `"playlistItem"`.
- `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`) += `"Playlist"`,
  `"PlaylistItem"`.
- The migration applies cleanly on top of the 7 existing migrations and from an
  empty database.

---

## 5. Validation — `src/lib/validation/playlists.ts`

zod schemas; every action `safeParse`s immediately after `requireRole`.

```
createPlaylistSchema      { name: 1..120 trimmed, description?: <=500 trimmed }
updatePlaylistSchema      { name?: 1..120, description?: <=500 (nullable),
                            defaultImageDurationSeconds?: int 1..3600,
                            defaultWebDurationSeconds?: int 1..3600 }
addItemsSchema            { mediaAssetIds: string[] min 1 max 100 (each min 1) }
setItemDurationSchema     { durationSeconds: int 1..3600 | null }
reorderItemsSchema        { itemIds: string[] min 1 }
idSchema                  string min 1        // for playlistId / itemId / screenId args
```

Messages are terse and end in a period, no em dashes / emojis / exclamation
points (repo copy rule).

---

## 6. Server actions & routes

All in `src/app/(app)/playlists/actions.ts` unless noted, all `"use server"`,
all: `requireRole(<action>)` first → `safeParse` → work inside
`withOrgTransaction` → `bumpRevision` where a playlist/item changed →
`writeAudit(...)` → `revalidatePath`. `redirect()` (if any) stays outside
try/catch. Every id from the caller is resolved through `ctx.db` (facade) so a
cross-org id reads as absent → `{ error }` or `NotFoundError`.

| Action | Role | Behavior |
|---|---|---|
| `createPlaylist(input)` | `playlist.create` | Create with defaults; `createdByUserId = ctx.user.id`. Returns `{ id }` or `{ error }`. Audit `playlist.create`. |
| `updatePlaylist(id, patch)` | `playlist.update` | Rename / description / default durations. `bumpRevision` (default-duration changes affect the manifest). Audit `playlist.update`. |
| `archivePlaylist(id)` / `restorePlaylist(id)` | `playlist.delete` / `playlist.update` | Set / clear `archivedAt`. Archiving does not touch screen assignments. Audit `playlist.archive` / `playlist.restore`. |
| `deletePlaylist(id)` | `playlist.delete` | Hard delete (cascades items; `Screen.playlistId` → null via SetNull). Only offered from the editor with a confirm. Audit `playlist.delete`. |
| `addItems(playlistId, { mediaAssetIds })` | `playlist.update` | For each id: it must resolve via `ctx.db.mediaAsset` and be non-archived (a `FAILED`/`UPLOADING` asset is rejected with a clear `{ error }`). Append in the given order at `position = n, n+1, ...`. `bumpRevision`. Audit `playlist.items.add` with `{ count }`. |
| `removeItem(itemId)` | `playlist.update` | Delete the item, compact the remaining positions to `0..n-2` in the same tx. `bumpRevision`. Audit `playlist.items.remove`. |
| `reorderItems(playlistId, { itemIds })` | `playlist.update` | `itemIds` must be a permutation of exactly the playlist's item ids (else `{ error: "That reorder does not match the playlist." }`). Rewrite `position` to the new order. `bumpRevision`. Audit `playlist.items.reorder`. |
| `setItemDuration(itemId, { durationSeconds })` | `playlist.update` | Set or clear (`null`) the per-item override. `bumpRevision`. Audit `playlist.items.duration`. |
| `setItemEnabled(itemId, enabled)` | `playlist.update` | Toggle. `bumpRevision`. Audit `playlist.items.enabled`. |
| `assignPlaylistToScreen(screenId, playlistId \| null)` | `playlist.assign` | Both ids resolve via `ctx.db`. Set `screen.playlistId`. Does NOT bump the playlist revision (screen membership is not in the manifest). Audit `screen.playlist.assign` with `{ screenId, playlistId }`. Used by both the editor's screen panel and the screen form. |

### `GET /api/player/sync` (`src/app/api/player/sync/route.ts`)

Replace the stub body. After `authenticateDevice` + the existing `player.sync`
actor check:

- Load the screen (`id`, `organizationId`, `pollIntervalSeconds`, `playlistId`)
  via the **root** client with an explicit `where` (device-authed route, same
  pattern as `pair` — no session org context). Justify the root import with an
  eslint allow-list entry for this file if not already covered.
- If `playlistId` is null → `{ screenId, pollIntervalSeconds, playlist: null }`.
- Else load the playlist and its `enabled` items ordered by `position`, then the
  referenced `MediaAsset` rows in one `findMany`.
- Build the manifest with the pure function in §7; sign IMAGE/VIDEO URLs with
  `storage.createDownloadUrl(storageKey, 3600)`.
- Response shape:

```json
{
  "screenId": "...",
  "pollIntervalSeconds": 60,
  "playlist": {
    "id": "...",
    "name": "...",
    "revision": 7,
    "items": [
      { "id": "...", "kind": "IMAGE", "url": "https://...", "durationSeconds": 10,
        "mimeType": "image/png", "width": 1280, "height": 720 },
      { "id": "...", "kind": "VIDEO", "url": "https://...", "durationSeconds": 0,
        "mimeType": "video/mp4", "width": 3840, "height": 2160 },
      { "id": "...", "kind": "WEB", "url": "https://example.com",
        "durationSeconds": 30, "mimeType": null, "width": null, "height": null }
    ]
  }
}
```

- Wrapped in the route's existing `withRequestId` + `toProblem` error handling.
- `canvas` is no longer in the response (the stub key is removed; no client
  depends on it).

---

## 7. Manifest assembly — `src/lib/player/manifest.ts`

A pure, unit-tested function, no I/O:

```ts
export interface ManifestItem {
  id: string;
  kind: "IMAGE" | "VIDEO" | "WEB";
  url: string;
  durationSeconds: number; // 0 for a video of unknown length => play to natural end
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

export function assembleManifest(args: {
  playlist: { defaultImageDurationSeconds: number; defaultWebDurationSeconds: number };
  items: { id: string; mediaAssetId: string; position: number; durationSeconds: number | null; enabled: boolean }[];
  assetsById: Map<string, {
    kind: "IMAGE" | "VIDEO" | "WEB";
    status: string;
    archivedAt: Date | null;
    storageKey: string | null;
    url: string | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
  }>;
  signUrl: (storageKey: string) => string; // caller passes a bound presigner
}): ManifestItem[];
```

Rules:

- Sort `items` by `position` ascending; keep only `enabled` items whose asset is
  present, `status === "READY"`, `archivedAt == null`.
- `kind` `WEB` → `url = asset.url` (skip the item if `asset.url` is null).
  `IMAGE` / `VIDEO` → `url = signUrl(asset.storageKey)` (skip if `storageKey`
  is null).
- Duration:
  - `item.durationSeconds` set → use it.
  - else `IMAGE` / `WEB` → the matching playlist default.
  - else `VIDEO` → `asset.durationSeconds ?? 0`.
- `mimeType` / `width` / `height` are copied from the asset (`null` for `WEB`).

`assembleManifest` never throws; a malformed item is skipped.

---

## 8. `purgeArchivedMedia` worker fix

`src/worker/jobs/purgeArchivedMedia.ts` currently purges an archived asset when
`picture.count + video.count === 0`. Add `playlistItem.count({ where: { mediaAssetId } })`
to that guard: if any `PlaylistItem` references the asset, skip the purge (leave
it archived). Without this, a purge of an asset still in a playlist would throw
on the `onDelete: Restrict` FK. Update the job's test to cover
"archived asset referenced by a `PlaylistItem` is kept".

---

## 9. RBAC — `src/lib/rbac/policy.ts`

Add to the `Action` union and `POLICY`:

| Action | Group |
|---|---|
| `playlist.view` | `ALL` |
| `playlist.create` | `CONTENT_UP` |
| `playlist.update` | `CONTENT_UP` |
| `playlist.delete` | `MANAGERS_UP` |
| `playlist.assign` | `MANAGERS_UP` |

`src/lib/nav.ts`: the `/playlists` item gets `action: "playlist.view"`.
`can.test.ts` / `nav.test.ts` updated for the new rows.

---

## 10. UI — `src/app/(app)/playlists/`

Server components load through `ctx.db`; every function / event handler lives in
`"use client"` children (no render-closure props across the RSC boundary —
Foundation lesson). bigints are not involved here.

### 10.1 `/playlists` — list (`page.tsx`, replaces `ComingSoon`)

- `requireRole("playlist.view")`. One `withOrgTransaction`: playlists
  (`archivedAt: null`) with `_count.items`, plus a per-playlist assigned-screen
  count (`screen.groupBy` by `playlistId`).
- `<PageHeader title="Playlists" actions={<NewPlaylistDialog/>}>` +
  `<PlaylistList rows={...} canCreate={can(ctx.actor,"playlist.create")} />`.
- Empty state via `<EmptyState>` when there are none.
- Each row links to `/playlists/[id]`; shows name, item count, "on N screens",
  updated-at label.

### 10.2 `/playlists/[id]` — editor (`[id]/page.tsx` + client components)

- `requireRole("playlist.view")`; 404 (`notFound()`) if the playlist is not in
  the org. One `withOrgTransaction`: the playlist, its items ordered by
  `position` with each item's `MediaAsset` (`id`, `name`, `kind`, `status`,
  `archivedAt`, `thumbnailKey`, `durationSeconds`), the org's screens
  (`id`, `name`, `locationName`, `playlistId`), and this playlist's assigned
  screen ids. Presign each item asset's `thumbnailKey` server-side (1h) and pass
  `thumbnailUrl` on the serializable prop (same approach as the media grid);
  items with no thumbnail get `null` and the row shows a kind glyph.
- Client components under `src/components/app/playlists/`:
  - `playlist-editor.tsx` — owns the item list, calls the item actions, shows a
    running total duration, "unavailable" badge on any item whose asset is
    archived / not `READY`.
  - `playlist-item-row.tsx` — thumbnail, name, kind badge, duration control
    (number input; empty = "default"), enable/disable toggle, up / down / remove
    buttons, optional drag handle.
  - `add-media-dialog.tsx` — a dialog wrapping a compact version of the media
    grid (reuse `MediaCard` read-only + multi-select); confirm calls
    `addItems`.
  - `assigned-screens-panel.tsx` — list of the org's screens with a checkbox per
    screen bound to `assignPlaylistToScreen(screenId, thisPlaylistId | null)`;
    gated by `canAssign`.
  - `playlist-settings-dialog.tsx` — name, description, default durations
    (`updatePlaylist`).
  - `new-playlist-dialog.tsx` — used on the list page.
- Capability props: `canUpdate` (`playlist.update`), `canDelete`
  (`playlist.delete`), `canAssign` (`playlist.assign`).
- After every mutation the client calls `router.refresh()`.

### 10.3 Screen form

`src/app/(app)/screens/` — the create and edit screen forms gain a "Playlist"
`<select>` (org's non-archived playlists + a "None" option). On submit the form
calls `assignPlaylistToScreen(screenId, playlistId | null)` (create: after the
screen exists; edit: directly). `createScreen` / its validation may accept an
optional `playlistId` but the assignment goes through the shared action so the
`playlist.assign` gate and audit apply uniformly.

---

## 11. Testing

- **Unit** (`src/lib/player/manifest.test.ts`): `assembleManifest` — order by
  position; skip disabled; skip archived / non-`READY` / missing asset; skip
  `WEB` with null `url` and `IMAGE` with null `storageKey`; duration resolution
  for all three kinds incl. the override and the video-`0` fallback; `signUrl`
  is only called for `IMAGE` / `VIDEO`.
- **Unit** (`src/lib/validation/playlists.test.ts`): each schema's accept /
  reject edges (blank name, over-long description, duration `0` / `3601`, empty
  `mediaAssetIds`, `> 100` ids).
- **Integration** (`src/app/(app)/playlists/playlists.test.ts`, real DB): create
  → add 3 items → positions `0,1,2` and `revision` incremented each time;
  reorder → positions follow `itemIds`, `revision` bumped; reorder with a wrong
  id set → `{ error }`, no change; remove middle item → positions compact to
  `0,1`; `setItemDuration` / `setItemEnabled` bump `revision`; `addItems` with an
  archived asset id → `{ error }`; `assignPlaylistToScreen` sets / clears
  `screen.playlistId` and does not bump `revision`; a cross-org `mediaAssetId` in
  `addItems` is rejected.
- **Integration** (`src/app/api/player/sync/*` test): a screen with a playlist of
  1 IMAGE + 1 VIDEO + 1 WEB, one disabled item, one item whose asset was
  archived → sync returns exactly the 2 live items in order, IMAGE/VIDEO URLs are
  presigned GETs against the local endpoint, WEB url is the raw asset url,
  `revision` matches; a screen with no playlist → `{ playlist: null }`; an
  unknown / missing device token → 401 problem (unchanged).
- **Isolation** (`src/test/isolation/tenant-isolation.spec.ts`): with org B
  owning a playlist + item + a screen: `forOrg(A)` never sees B's `Playlist` /
  `PlaylistItem`; every playlist action called with a B id returns `{ error }` /
  throws and leaves B's rows byte-unchanged; `assignPlaylistToScreen` with B's
  screen or B's playlist is rejected; `withOrgTransaction(A, raw SELECT)` returns
  none of B's playlist rows.
- **Worker** (`src/worker/jobs/media.test.ts` addition): an archived asset
  referenced by a `PlaylistItem` is not purged.
- **e2e** (`src/test/e2e/playlists.spec.ts`): register → create a playlist → add
  3 library assets (seeded in `beforeAll`, reusing the media fixture PNG for the
  image) → reorder one → set a per-item duration → assign the playlist to a
  screen → pair that screen via `POST /api/player/pair` → `GET /api/player/sync`
  with the device token → assert the manifest item order, the overridden
  duration, and that the image URL loads (`200` from MinIO).
- Full `npm run test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`
  green. CI already brings up MinIO.

**Known limitation (documented, not fixed here):** `revision` captures playlist
structure and per-item settings, not edits to a referenced asset (rename,
re-thumbnail) or an asset archived from the library. Sync always returns a
freshly filtered list, and the device must tolerate a dead media URL. A
`contentHash` folding in `max(asset.updatedAt)` is a candidate for the
scheduling or campaigns increment.

---

## 12. Deliverables

- `prisma/schema.prisma` — `Playlist`, `PlaylistItem`, `Screen.playlistId`,
  `MediaAsset.playlistItems`, `User.createdPlaylists`, `Organization` back-rels.
- `prisma/migrations/<ts>_playlists/migration.sql` — tables, column, FKs, RLS
  block.
- `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts` — list updates.
- `src/lib/rbac/policy.ts`, `src/lib/nav.ts` — `playlist.*` + nav gate.
- `src/lib/validation/playlists.ts`.
- `src/lib/player/manifest.ts`.
- `src/app/(app)/playlists/actions.ts`.
- `src/app/(app)/playlists/page.tsx`, `src/app/(app)/playlists/[id]/page.tsx`.
- `src/components/app/playlists/*` (six components listed in §10).
- `src/app/api/player/sync/route.ts` — real manifest.
- `src/worker/jobs/purgeArchivedMedia.ts` — `PlaylistItem` guard.
- `src/app/(app)/screens/` — screen-form playlist select + wiring.
- `eslint.config.mjs` — allow `@/lib/db/root` in the sync route if not already.
- Tests as in §11.
- `docs/architecture.md` — a "Playlists" section (models, assembly, sync payload,
  `revision` semantics, the known limitation); update the roadmap list.
- `scripts/simulate-playlists.ts` — a demo script matching the `simulate-*.ts`
  family: build two playlists for "Costa Signage Co" from the seeded media,
  assign one to several screens. Excluded from typecheck by the existing
  `scripts/simulate-*.ts` pattern.

---

## 13. Risks and open questions

- **Position rewrites under concurrent edits.** Two managers reordering the same
  playlist at once could interleave. `withOrgTransaction` serializes each action
  and `reorderItems` validates the id set, so the worst case is one editor's
  reorder losing to the other's; `revision` still advances and the next
  `router.refresh()` shows the winner. Acceptable for v1; a per-playlist
  optimistic version check is a later option.
- **`onDelete: Restrict` surprising an admin.** Trying to hard-delete a media
  asset that is in a playlist will fail at the DB. The media library only
  soft-deletes today, so this is only reachable via a future "permanent delete"
  UI; that UI (when built) should check `playlistItem` and tell the user which
  playlists to clear first.
- **Video of unknown length.** `durationSeconds: 0` in the manifest means "play
  to natural end". A device that cannot detect end-of-stream would need a
  fallback; documented in the payload contract.
- **Large playlists.** No cap on item count in v1 beyond the 100-per-`addItems`
  batch. A playlist with thousands of items would make one large sync payload;
  revisit with a cap or pagination if it ever matters.
