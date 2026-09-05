# Visual Canvas Editor (Plan 1) - Design Spec

**Increment:** 5 of the LyneSign rebuild, Plan 1 of 2 (1 Foundation, 3 Media Library, 4 Playlists, 6 Campaigns, 7 Schedule, 8 Analytics have shipped; 2 Player runtime is still open). Plan 2 (Weather + News live-data frames) is a separate spec.
**Status:** approved for planning.
**Date:** 2026-09-02.

A canvas is a fixed spatial layout: a `Canvas` (size + background) holds positioned,
z-ordered `Panel`s; each panel holds an ordered rotation of timed `Frame`s; each
frame carries one typed `Content` payload. The whole hierarchy already exists in
the schema from Foundation (built for the Display Monkey import) and is
RLS-forced and tenant-listed, but nothing reads or writes it. This plan makes it
authorable through a WYSIWYG editor and playable through `GET /api/player/sync`.
It ships five self-contained frame types: Image, Video, Text, Clock, and Web
(iframe). It does not ship Weather, News, YouTube-specific, or the
Outlook / Report / PowerBI enterprise types (Plan 2 and beyond), location-scoped
frames, per-panel transitions, canvas templates, or editor multi-select.

---

## 1. Context

### What exists today that this builds on

- **The `Canvas` / `Panel` / `Frame` / `Content` hierarchy** (`prisma/schema.prisma`):
  - `Canvas` - `organizationId`, `legacyId Int? @unique`, `name`, `width`, `height`,
    `backgroundColor String?`, `backgroundImageId String?` (a bare string today, no FK),
    timestamps. `panels Panel[]`, `screens Screen[]`. `@@index([organizationId])`.
  - `Panel` - `organizationId`, `canvasId`, `legacyId`, `name String?`, `x`, `y`,
    `width`, `height`, `zIndex Int @default(0)`, `noScroll Boolean @default(false)`.
    `canvas` `onDelete: Cascade`, `frames Frame[]`.
  - `Frame` - `organizationId`, `panelId`, `legacyId`, `sortOrder Int @default(0)`,
    `durationSeconds Int @default(10)`, `type FrameType`, `locationScoped Boolean @default(false)`,
    `createdAt`. `panel` `onDelete: Cascade`, `content Content?`, `frameLocations FrameLocation[]`.
  - `Content` - `organizationId`, `frameId String @unique`, `legacyId`, `name String?`,
    plus one optional relation to each typed row. `frame` `onDelete: Cascade`.
  - Typed rows used by this plan: `Clock` (`type`, `showDate`, `showTime`,
    `showSeconds`, `label String?`, `timeZone String?`), `Picture`
    (`mediaRef String?`, `mode String?`, `mediaAssetId String?` FK `SetNull`),
    `Video` (`mediaRef`, `mediaAssetId` FK `SetNull`), `Memo` (`body String`).
    All have `contentId String @id` + `organizationId` and `content` `onDelete: Cascade`.
  - `enum FrameType { CLOCK PICTURE VIDEO YOUTUBE HTML MEMO OUTLOOK REPORT POWERBI WEATHER NEWS }`.
  - All of `canvas` / `panel` / `frame` / `frameLocation` / `content` / `clock` /
    `picture` / `video` / `youtube` / `html` / `memo` / `weather` / `news` are
    already in `TENANT_MODELS` (`src/lib/db/tenant.ts`) and `TENANT_TABLES`
    (`src/test/isolation/tenant-tables.ts`) and RLS-forced. Today: 34 tenant tables.
- **`Screen.canvasId String?`** with relation `canvas Canvas? @relation(onDelete: SetNull)`.
  Read nowhere. `Screen.playlistId String?` (`onDelete: SetNull`) is the base
  playlist. A screen has both columns; nothing enforces one-or-the-other today.
- **`resolveScreenContent`** (`src/lib/player/campaign.ts`, pure) resolves, per
  screen per instant: active campaign -> matching schedule rule -> `Screen.playlistId`
  -> `{ source: "none" }`. Output union has `campaign` / `schedule` / `playlist` /
  `none` arms. `GET /api/player/sync` calls it, then assembles a manifest for the
  effective playlist and returns
  `{ screenId, pollIntervalSeconds, source, campaign, schedule, playlist }` (each
  of the last three is an object or `null`).
- **`assembleManifest`** (`src/lib/player/manifest.ts`, pure) - the playlist
  manifest builder: position order, drops disabled / non-`READY` / archived /
  missing assets, resolves IMAGE/VIDEO to presigned GET URLs (3600s) via an
  injected `signUrl`, WEB to the raw `url`, durations from item override -> playlist
  default -> `asset.durationSeconds ?? 0`.
- **`Playlist.revision`** is a monotonic `Int @default(1)` bumped by
  `bumpRevision(tx, id)` (`src/lib/playlists/revision.ts`) as the first statement
  of every mutating transaction, so the row lock serializes structural edits.
  `Campaign` / `ScheduleRule` follow the same pattern.
- **`AddMediaDialog`** (`src/components/app/playlists/add-media-dialog.tsx`) is the
  media-picker pattern: it browses the org's `READY` `MediaAsset`s and returns a
  selection. The canvas Image / Video content editors reuse this pattern.
- **RBAC** (`src/lib/rbac/policy.ts`): `Action` union + `POLICY: Record<Action, Role[]>`.
  Groups: `ALL` (incl `VIEWER`), `CONTENT_UP` (OWNER/ADMIN/MANAGER/CONTENT_MANAGER),
  `MANAGERS_UP`, `ADMINS_UP`. `playlist.create` / `.update` = `CONTENT_UP`.
  `requireRole(action)` returns `ctx = { user, organizationId, role, db, actor }`;
  `can(actor, action)` is the page-side predicate.
- **Two-layer tenant isolation.** `$extends` facade (`forOrg` / `withOrgTransaction`,
  `src/lib/db/tenant.ts`) injects `organizationId` and fails closed; Postgres
  `FORCE ROW LEVEL SECURITY` with predicate
  `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`
  (USING + WITH CHECK). Triplicated table list guarded by
  `src/lib/db/tenant-model-list.test.ts` (set equality, no count literal).
- **`/screens`** is a list page (`page.tsx` + `screens-table.tsx` + `actions.ts`);
  there is no `/screens/[id]` route. The screen content-source control lives in
  the screens table as a per-row dialog.
- **Nav** (`src/lib/nav.ts`) has no Canvas entry. No `/canvas` route exists.
- **No drag-and-drop, no chart, no date-picker library.** `date-fns` is installed.
  Direct manipulation is pointer events + CSS transforms.
- **Standard server-action pattern**: `requireRole` first, `safeParse`, work inside
  `withOrgTransaction` with the revision bump as the first statement, `writeAudit`,
  `revalidatePath`. `redirect` (if any) outside the try/catch.

---

## 2. Scope

### In scope

1. Schema: `Canvas.revision` / `Canvas.archivedAt`, `Canvas.backgroundImageId`
   becomes a real `MediaAsset?` FK (`SetNull`), a `WEB` `FrameType` value, a new
   `Web { url }` typed content model. One migration + RLS `ARRAY['Web']` block.
   `Web` added to the three tenant lists (-> 35).
2. `src/lib/canvas/revision.ts` - `bumpCanvasRevision(tx, canvasId)`.
3. `canvas.*` RBAC actions (`view` = `ALL`, `create` / `update` / `delete` =
   `CONTENT_UP`) and the `/canvas` nav gate.
4. `src/lib/validation/canvas.ts` - zod schemas for every action.
5. Pure geometry helpers (`src/lib/canvas/geometry.ts`) - snap-to-grid, alignment
   guides, clamp-to-bounds.
6. Pure `src/lib/player/canvas-manifest.ts` - `assembleCanvasManifest`.
7. `resolveScreenContent` gains a `canvas` input and a `{ source: "canvas" }` arm;
   precedence campaign -> schedule -> canvas -> base playlist -> none.
8. `GET /api/player/sync` serves a canvas manifest when `source === "canvas"`;
   `canvas: null` added to every other branch.
9. Server actions: canvas CRUD + duplicate + archive/restore; panel CRUD +
   batch geometry update + z-order; frame CRUD + reorder + duration; content
   upsert per type (Image, Video, Text, Clock, Web); `setScreenContentSource`.
10. `/canvas` list page and `/canvas/[id]` WYSIWYG editor with the five content
    editors and a canvas preview player. The screens table gains a content-source
    dialog.
11. `deletePlaylist` is unaffected; a new `deleteCanvas` guard refuses a canvas a
    screen still uses.
12. `scripts/simulate-canvas.ts`; tests (pure, integration, tenant isolation,
    component geometry, e2e); `docs/architecture.md` section + roadmap.

### Out of scope (Plan 2, later, or never)

- **Weather and News frames** - Plan 2: provider config, server-side fetch +
  cache, an RSS parser dependency.
- YouTube-specific, Outlook, Report, PowerBI frame editors. The `WEB` iframe type
  covers a YouTube embed URL and a dashboard URL without a dedicated editor.
- `FrameLocation` location-scoping (a frame shows on every screen using the canvas).
- Per-panel transitions / animations, canvas templates, a canvas library / sharing,
  editor multi-select, copy-paste of panels across canvases, undo/redo.
- Any change to the playlist, campaign, or schedule resolution tiers themselves.
- Rewriting `Screen` to a single `contentSource` enum column - the two nullable
  columns stay; the action keeps them mutually exclusive.

---

## 3. Architecture

### 3.1 Screen content resolution

`resolveScreenContent` (`src/lib/player/campaign.ts`) input gains
`canvas?: { canvasId: string } | null`. Resolution order:

1. Active campaign (unchanged) -> `source: "campaign"`, effective playlist.
2. Matching schedule rule (unchanged) -> `source: "schedule"`.
3. **`canvas` non-null -> `{ source: "canvas"; canvasId }`.**
4. `Screen.playlistId` -> `{ source: "playlist"; playlistId }`.
5. `{ source: "none" }`.

The `canvas` arm carries only `canvasId`; the route does the tree load. `canvas`
and `playlist` are never both present in one resolution.

### 3.2 `GET /api/player/sync` (`src/app/api/player/sync/route.ts`)

- The screen load already selects `playlistId`; add `canvasId`.
- Build the `canvas` input as `screen.canvasId ? { canvasId: screen.canvasId } : null`,
  pass it into `resolveScreenContent`.
- When `resolved.source === "canvas"`: load the canvas tree scoped to
  `screen.organizationId`
  (`prisma.canvas.findFirst({ where: { id, organizationId }, include: { panels: { include: { frames: { include: { content: { include: { clock: true, picture: true, video: true, memo: true, web: true } } } }, orderBy: { zIndex: "asc" } } } } })`,
  frames ordered `sortOrder asc` in a nested `orderBy`), collect the referenced
  `mediaAssetId`s, load those `MediaAsset`s scoped to the org, presign the storage
  keys once, and call `assembleCanvasManifest`.
- Response: `{ ...base, source: "canvas", campaign: campaignPayload, schedule: null, playlist: null, canvas: {...} }`.
  (A canvas screen can still be taken over by a campaign, in which case
  `source: "campaign"` and `canvas: null` - the canvas branch is only reached
  when no campaign or schedule won.)
- Add `canvas: null` to the `source: "none"` early return, the campaign branch,
  the schedule branch, and the playlist branch.
- If the canvas row is missing or has zero usable panels, fall through to the base
  playlist (do not 500): recompute as if `canvas` were null. A comment records this.

### 3.3 `assembleCanvasManifest` - `src/lib/player/canvas-manifest.ts`

Pure. Signature:

```ts
type CanvasTree = {
  id: string; name: string; revision: number;
  width: number; height: number;
  backgroundColor: string | null;
  backgroundImage: { storageKey: string | null; url: string | null } | null;
  panels: Array<{
    id: string; name: string | null;
    x: number; y: number; width: number; height: number;
    zIndex: number; noScroll: boolean;
    frames: Array<{
      id: string; durationSeconds: number; type: FrameType; sortOrder: number;
      content: {
        clock?: { type: number; showDate: boolean; showTime: boolean; showSeconds: boolean; label: string | null; timeZone: string | null } | null;
        picture?: { mode: string | null; asset: { kind: "IMAGE"; storageKey: string | null; status: string; archivedAt: Date | null } | null } | null;
        video?: { asset: { kind: "VIDEO"; storageKey: string | null; durationSeconds: number | null; status: string; archivedAt: Date | null } | null } | null;
        memo?: { body: string } | null;
        web?: { url: string } | null;
      } | null;
    }>;
  }>;
};

export function assembleCanvasManifest(
  tree: CanvasTree,
  signUrl: (storageKey: string) => string,
): CanvasManifest;
```

Rules:

- Panels: keep all, sorted by `zIndex` asc then `id` asc (deterministic). A panel
  whose every frame is dropped is itself dropped.
- Frames within a panel: sorted by `sortOrder` asc then `id` asc. A frame is
  dropped when: its `type` is not one of `CLOCK` / `PICTURE` / `VIDEO` / `MEMO` /
  `WEB` (a legacy `HTML` / `YOUTUBE` / enterprise-type frame from the DM import
  has no Plan-1 renderer); or `content` is null; or its type is `PICTURE` /
  `VIDEO` and the asset is null / not `READY` / archived / has no `storageKey`;
  or its type is `WEB` and `url` is empty; or its type is `MEMO` and `body` is
  empty. The `CLOCK` type is never dropped.
- URL resolution: `PICTURE` / `VIDEO` -> `signUrl(storageKey)` (presigned GET);
  the background image the same. `WEB` -> the raw `url`.
- Durations: `frame.durationSeconds` verbatim (already a column default 10). A
  `VIDEO` frame with `durationSeconds` 0 signals "play to end" (the player's
  concern); pass 0 through.
- Output `CanvasManifest`:
  ```ts
  {
    id: string; name: string; revision: number;
    width: number; height: number;
    background: { color: string | null; imageUrl: string | null };
    panels: Array<{
      id: string; x: number; y: number; width: number; height: number;
      zIndex: number; noScroll: boolean;
      frames: Array<{ id: string; durationSeconds: number; kind: "image" | "video" | "text" | "clock" | "web";
        image?: { url: string; mode: string | null };
        video?: { url: string; durationSeconds: number | null };
        text?: { body: string };
        clock?: { showDate: boolean; showTime: boolean; showSeconds: boolean; label: string | null; timeZone: string | null; style: number };
        web?: { url: string };
      }>;
    }>;
  }
  ```
  `kind` is the lowercased simplified type; `style` on clock is the legacy `type` int.

### 3.4 Revision

`Canvas.revision Int @default(1)`. `bumpCanvasRevision(tx, canvasId)`
(`src/lib/canvas/revision.ts`) = `tx.canvas.update({ where: { id }, data: { revision: { increment: 1 } } })`, called as the first statement of every
mutating transaction that touches the canvas or any descendant (panel, frame,
content). `archiveCanvas` / `restoreCanvas` / `deleteCanvas` do **not** bump (an
archived or deleted canvas stops being served; the device sees `source` flip on
its next poll). `setScreenContentSource` edits the `Screen` row, not the canvas,
so it bumps nothing - the device re-resolves its content source on the next poll.

### 3.5 No new dependencies

Direct manipulation is pointer events + `transform`. `date-fns` (installed) drives
the Clock preview. The `WEB` preview and player use a sandboxed `<iframe>`.

---

## 4. Data model

### 4.1 `Canvas` changes

Add: `revision Int @default(1)`, `archivedAt DateTime? @db.Timestamptz(3)`.
Change `backgroundImageId` from a bare `String?` to an FK:
`backgroundImageId String?` + `backgroundImage MediaAsset? @relation("CanvasBackground", fields: [backgroundImageId], references: [id], onDelete: SetNull)`
and a `MediaAsset.canvasBackgrounds Canvas[] @relation("CanvasBackground")`
back-relation. The migration sets any existing non-cuid `backgroundImageId` to
`NULL` before adding the constraint (the DM import stored a legacy ref string
there; a comment records this).

Add `@@index([organizationId, archivedAt])`.

### 4.2 `enum FrameType`

Append `WEB`. (Prisma appends enum values without a table rewrite; the migration
is `ALTER TYPE "FrameType" ADD VALUE 'WEB'`.)

### 4.3 `model Web`

```prisma
model Web {
  contentId      String @id
  organizationId String
  url            String

  content Content @relation(fields: [contentId], references: [id], onDelete: Cascade)
}
```

`Content.web Web?` back-relation. Added to `TENANT_MODELS` (`"web"`),
`TENANT_TABLES` (`"Web"`), and the migration RLS `ARRAY['Web']` block (predicate
byte-identical to `20260830032500_rls_empty_guc_is_unscoped`). -> 35 tenant tables.

### 4.4 No CHECK constraints

Panel / frame geometry bounds and duration ranges are enforced in zod and in the
editor, not the DB - a panel is allowed to extend past the canvas edge (the
player clips), and `Panel.width` / `height` can legitimately be small. The only
invariant worth a DB guard, `frame.durationSeconds >= 0`, is already covered by
`@default(10)` and the zod `min(0)`; skip the CHECK to keep the migration a pure
additive one.

---

## 5. Validation - `src/lib/validation/canvas.ts`

- `idSchema` = `z.object({ id: z.string().cuid() })`.
- `createCanvasSchema` - `name` 1..120, `width` int 240..7680, `height` int
  240..7680, `backgroundColor` optional `#rrggbb` regex, `backgroundImageId`
  optional cuid.
- `updateCanvasSchema` - all of the above optional; `.refine` nothing (partial).
- `panelSchema` - `name` optional <= 80, `x` / `y` int -10000..20000 (allow
  slight off-canvas), `width` / `height` int 1..20000, `zIndex` int 0..9999,
  `noScroll` boolean.
- `createPanelSchema` = `panelSchema` + `canvasId`.
- `updatePanelsSchema` - `{ panels: z.array(z.object({ id: cuid }).and(panelSchema.partial())).min(1).max(200) }` - the batch geometry / z-order update the editor sends after a drag or a reorder.
- `frameSchema` - `durationSeconds` int 0..86400, `type` `z.enum([...FrameType values used: "CLOCK","PICTURE","VIDEO","MEMO","WEB"])`.
- `createFrameSchema` = `{ panelId: cuid, type, durationSeconds }`.
- `reorderFramesSchema` = `{ panelId: cuid, frameIds: z.array(cuid).min(1).max(500) }`.
- `setFrameDurationSchema` = `{ id: cuid, durationSeconds: int 0..86400 }`.
- Content upsert schemas, one per type, all `{ frameId: cuid, ... }`:
  - `imageContentSchema` - `mediaAssetId` cuid, `mode` optional `z.enum(["cover","contain","fill","none"])`.
  - `videoContentSchema` - `mediaAssetId` cuid.
  - `textContentSchema` = `{ frameId: cuid, body: z.string().max(5000) }`. Empty
    `body` is allowed at the schema (the manifest drops an empty one). No
    align / color / size fields in Plan 1 - `Memo` stays a plain `body` string;
    text styling arrives with Plan 2.
  - `clockContentSchema` - `{ frameId, style: int 0..3, showDate, showTime, showSeconds, label optional <=40, timeZone optional IANA string }`.
  - `webContentSchema` - `{ frameId, url: z.string().url().max(2048) }`.
- `setScreenContentSourceSchema` - `{ screenId: cuid, source: z.enum(["playlist","canvas","none"]), playlistId: cuid.optional(), canvasId: cuid.optional() }` with a `.refine`: `source === "playlist"` requires `playlistId`, `source === "canvas"` requires `canvasId`, `source === "none"` forbids both.

---

## 6. Server actions - `src/app/(app)/canvas/actions.ts` and screens

Every action: `requireRole(<action>)` first; `safeParse`; resolve caller ids
through `ctx.db`; `withOrgTransaction` whose first statement is
`bumpCanvasRevision(tx, canvasId)` for any existing-canvas mutation; mutate;
`writeAudit`; `revalidatePath("/canvas")` (and `/canvas/${id}` for editor
actions). `createCanvas` `redirect("/canvas/<id>")` outside the try/catch.

| action | role | returns | notes |
| --- | --- | --- | --- |
| `createCanvas(input)` | canvas.create | `{ id } \| { error }` | one panel is NOT auto-created; an empty canvas is valid |
| `updateCanvas(id, patch)` | canvas.update | `{ id } \| { error }` | name / size / background; shrinking size does not delete panels |
| `duplicateCanvas(id)` | canvas.create | `{ id } \| { error }` | deep-copies panels, frames, content rows (new ids, `legacyId` null, `revision` 1) |
| `archiveCanvas(id)` / `restoreCanvas(id)` | canvas.update | `{ ok: true } \| { error }` | no bump; restore is refused only if... nothing, restore always allowed |
| `deleteCanvas(id)` | canvas.delete | `{ ok: true } \| { error }` | refused when `ctx.db.screen.count({ where: { canvasId: id } }) > 0` with "That canvas is assigned to N screens. Change their content source first." Cascade deletes panels / frames / content. No bump. |
| `createPanel(input)` | canvas.update | `{ id } \| { error }` | |
| `updatePanels(canvasId, { panels })` | canvas.update | `{ ok: true } \| { error }` | batch: the editor sends every changed panel's geometry / z after a drag, resize, or reorder, in one call |
| `deletePanel(id)` | canvas.update | `{ ok: true } \| { error }` | cascade |
| `duplicatePanel(id)` | canvas.update | `{ id } \| { error }` | offsets the copy by grid |
| `createFrame({ panelId, type, durationSeconds })` | canvas.update | `{ id } \| { error }` | also creates the empty `Content` row; `sortOrder` = current max + 1 |
| `reorderFrames({ panelId, frameIds })` | canvas.update | `{ ok: true } \| { error }` | rewrites `sortOrder` 0..n-1 |
| `setFrameDuration({ id, durationSeconds })` | canvas.update | `{ ok: true } \| { error }` | |
| `deleteFrame(id)` | canvas.update | `{ ok: true } \| { error }` | cascade removes `Content` + typed row |
| `setImageContent` / `setVideoContent` / `setTextContent` / `setClockContent` / `setWebContent` | canvas.update | `{ ok: true } \| { error }` | upsert the typed row for the frame's `Content`; changing a frame's type deletes the old typed row and its `Content.name`; each also sets `Frame.type` to match |
| `setScreenContentSource({ screenId, source, playlistId?, canvasId? })` | screen.update | `{ ok: true } \| { error }` | sets exactly one of `playlistId` / `canvasId` and nulls the other (`source: "none"` nulls both); resolves the id through `ctx.db`; audits `screen.setContentSource`; no canvas revision bump |

`ScheduleOverlapError`-style: a caught known error becomes `{ error }`; unknown
errors rethrow.

`deletePlaylist` and `deleteCampaign` guards are unchanged (a canvas cannot
reference a playlist). `deleteMediaAsset` already `SetNull`s `Picture` / `Video` /
`Canvas.backgroundImageId` via the FK; no new guard.

---

## 7. RBAC - `src/lib/rbac/policy.ts`

Add `canvas.view` (`ALL`), `canvas.create` / `canvas.update` / `canvas.delete`
(`CONTENT_UP`). `src/lib/nav.ts`: `{ href: "/canvas", label: "Canvas", icon: "canvas", action: "canvas.view" }`
after the `/playlists` entry (canvases and playlists are both "what a screen
shows"). `policy.test.ts` / `nav.test.ts` extended. `src/components/app/nav-sidebar.tsx`
already renders whatever `nav.ts` lists; if it maps `icon` strings to components,
add a `canvas` icon (reuse `LayoutGrid` / `Frame` from lucide).

---

## 8. UI

### 8.1 `/canvas` - list (`src/app/(app)/canvas/page.tsx`)

Server component. `requireRole("canvas.view")`. Lists non-archived canvases
(archived behind a toggle) with: a scaled static thumbnail (the same renderer as
the preview, first frame of each panel, no rotation), `name`, `${width} x ${height}`,
"Used by N screens", updated-at. Actions per card gated on `can(ctx.actor, "canvas.update")`
/ `"canvas.delete"`: Edit (link), Duplicate, Archive/Restore, Delete (confirm,
shows the screen-usage guard message inline when blocked). A "New canvas" dialog
(name + size presets 1920x1080 / 1080x1920 / 3840x2160 / custom).

### 8.2 `/canvas/[id]` - editor (`src/app/(app)/canvas/[id]/page.tsx` + client)

Server page loads the full tree scoped through `ctx.db`, serializes it (no `Date`
objects; `updatedAt` as ISO), and passes `canManage = can(ctx.actor, "canvas.update")`
plus the org's `READY` media assets (id, name, kind, a thumbnail key) for the
Image / Video pickers. Renders `<CanvasEditor>` (client).

`<CanvasEditor>` (`src/components/app/canvas/canvas-editor.tsx`):

- **Stage**: a `position: relative` box at `scale = min(availW / canvas.width, availH / canvas.height)`,
  panels as absolutely positioned `<div>`s (`left/top/width/height` in canvas
  units, the stage `transform: scale(...)`). A toggleable grid overlay
  (`repeating-linear-gradient`) at the current grid size (8 / 16 / 32 canvas px,
  default 8; a "no snap" option = grid 1).
- **Direct manipulation** (pointer events, no library):
  - Drag a panel: pointer delta / scale added to `x` / `y`, then run
    `snap(value, gridSize)` and the alignment pass (see 8.3). A visible guide line
    is drawn when an edge or center aligns (within `SNAP_TOLERANCE` canvas px)
    with another panel's edge/center or the canvas edges/center.
  - Resize: 8 handles; the dragged handle moves one or two edges; the same snap +
    guide pass runs on the moving edges; enforce `width` / `height` >= `MIN_PANEL`
    (16 canvas px).
  - Arrow keys nudge the selected panel by 1 canvas px; Shift+Arrow by the grid
    size. Escape deselects. Delete key removes the selected panel (with an
    inline confirm for a panel that has frames).
  - On pointer-up, the editor calls `updatePanels(canvasId, { panels: [<the moved/resized panel(s)>] })`
    once, and `router.refresh()` is not needed (optimistic local state is the
    source of truth; a returned `{ error }` reverts and toasts).
- **Panel inspector** (right rail, when a panel is selected): numeric
  `x` / `y` / `width` / `height` / `zIndex`, `name`, `noScroll`; "Bring forward" /
  "Send back" (swaps `zIndex` with the neighbour); "Duplicate panel"; "Delete panel".
- **Frame strip** (bottom, for the selected panel): the panel's frames in
  `sortOrder`, each a chip showing the type icon + a truncated label + duration.
  Drag to reorder (`reorderFrames`). "Add frame" -> a type menu (Image / Video /
  Text / Clock / Web) -> `createFrame` -> the new frame is selected and its
  content editor opens. Per-frame: duration input (`setFrameDuration`), delete
  (`deleteFrame`).
- **Content editor** (opens when a frame is selected), one per type:
  - **Image / Video**: `<AddMediaDialog>`-style picker filtered to `IMAGE` /
    `VIDEO`; shows the current asset name + thumbnail; Image adds a `mode`
    select (cover / contain / fill / none). `setImageContent` / `setVideoContent`.
  - **Text**: a `<textarea>` (`body`, <= 5000). `setTextContent`.
  - **Clock**: a `style` select (0..3, with a one-line description each),
    `showDate` / `showTime` / `showSeconds` switches, `label` text, `timeZone`
    select (IANA list; blank = screen local). A live preview using `date-fns`.
    `setClockContent`.
  - **Web**: a URL input (validated `https?://`), a "Preview" toggle that mounts a
    sandboxed `<iframe sandbox="allow-scripts allow-same-origin">` at the stage
    panel's aspect. `setWebContent`.
- **Canvas settings** (a dialog): `name`, `width` / `height` (a warning line when
  the new size is smaller than a panel's `x + width` or `y + height`), background
  color (`<input type="color">` + hex), background image (media picker, IMAGE
  only, clearable). `updateCanvas`.
- **Preview** ("Play"): a modal that renders the canvas at fit scale with every
  panel cycling its frames on their real `durationSeconds` (a shared
  `<CanvasStage>` renderer, `mode="play"`), Image/Video from a session-authed
  preview route, Web in the sandboxed iframe, Clock ticking. Pause / resume /
  restart. Reused by the list thumbnail (`mode="thumb"`, first frame only).

### 8.3 Geometry helpers - `src/lib/canvas/geometry.ts` (pure, unit-tested)

Constants: `MIN_PANEL = 16`, `SNAP_TOLERANCE = 8` (both in canvas px), default
`GRID = 8`.

- `snap(value: number, grid: number): number` - nearest multiple; `grid <= 1`
  returns `value`.
- `clampPanel(rect, canvas): Rect` - keeps at least `MIN_PANEL` on-canvas
  (a panel may hang off an edge but not vanish); enforces `MIN_PANEL` min size.
- `alignmentGuides(moving: Rect, others: Rect[], canvas: { width, height }, tolerance: number): { x: number | null; y: number | null; guides: Guide[] }`
  - for the moving rect's left / center-x / right against every other rect's and
  the canvas's left / center-x / right (and the y equivalents), returns the
  single closest snap offset per axis within `tolerance` and the guide lines to
  draw. Deterministic tie-break: smallest absolute delta, then lowest candidate
  coordinate.
- `nextZIndex(panels): number`, `swapZ(panels, id, dir): panels`.

### 8.4 Screens table - content source

`src/app/(app)/screens/screens-table.tsx` gains a per-row "Content source" cell
showing `Playlist: <name>` / `Canvas: <name>` / `None`, and a dialog
(`<ScreenContentSourceDialog>`) with a radio (Playlist / Canvas / None) plus the
matching `<select>` of the org's non-archived playlists or canvases. Submits
`setScreenContentSource`. Gated on `can(ctx.actor, "screen.update")`.

### 8.5 Preview route

`GET /api/canvas/[id]/preview` - `requireRole("canvas.view")`, loads the tree
through `ctx.db`, calls `assembleCanvasManifest` with a session-scoped
`storage.createDownloadUrl`, returns the `CanvasManifest`. The editor's Play
modal and the list thumbnail fetch this. Mirrors
`GET /api/playlists/[id]/preview`.

---

## 9. Demo - `scripts/simulate-canvas.ts`

Mirrors the `simulate-*.ts` family (idempotent, `--force`, "Costa Signage Co").
Builds two canvases:

- **Lobby Board** 1920x1080: a full-bleed media panel (rotation of 3 storefront
  images, 8s each), a top-right clock panel (style 1, time + date), a bottom
  ticker-style text panel ("Welcome to Costa Signage"), a small web panel
  (a public dashboard URL).
- **Portrait Menu** 1080x1920: two stacked media panels.

Puts one currently-playlist screen ("Storefront LED Wall") into canvas mode
pointing at Lobby Board via `setScreenContentSource`. Prints a summary table
(canvases, panels, frames, screens switched).

---

## 10. Testing

### 10.1 Pure - `src/lib/canvas/geometry.test.ts`

`snap` (nearest multiple, `grid <= 1` passthrough, negatives); `clampPanel`
(min size, off-edge allowed but not fully off, exact-fit); `alignmentGuides`
(edge-to-edge, center-to-center, canvas-center, no-guide beyond tolerance,
tie-break determinism, both axes independent).

### 10.2 Pure - `src/lib/player/canvas-manifest.test.ts`

`assembleCanvasManifest`: panel `zIndex` then `id` ordering; frame `sortOrder`
then `id` ordering; drop rules per type (null content, non-READY / archived /
missing-key asset for Image/Video, empty `url` for Web, empty `body` for Memo,
Clock never dropped); a panel with all frames dropped is itself dropped;
presigned URL resolution via the injected `signUrl`; background image resolution;
`durationSeconds` and clock `style` passthrough; `kind` lowercasing.

### 10.3 Pure - `src/lib/player/campaign.test.ts` (extend)

`resolveScreenContent` with the `canvas` input: canvas present, no campaign / no
schedule -> `source: "canvas"`; campaign present + canvas present -> `source: "campaign"`;
schedule present + canvas present -> `source: "schedule"`; canvas null ->
existing playlist / none behaviour unchanged; canvas present + `Screen.playlistId`
also set -> canvas wins (it is checked first).

### 10.4 Validation - `src/lib/validation/canvas.test.ts`

Every schema's accept / reject cases, especially the `setScreenContentSource`
refine (each `source` value's id requirement) and the `updatePanels` batch shape.

### 10.5 Integration - `src/app/(app)/canvas/canvas.test.ts` (real DB, ctx-mock)

- create / update / duplicate (deep copy: assert new panel + frame + content-row
  ids, `revision` 1 on the copy) / archive / restore / delete.
- `deleteCanvas` refused while a screen points at it; succeeds after
  `setScreenContentSource(..., "none")`.
- panel CRUD; `updatePanels` batch applies every panel's geometry and bumps
  `revision` once; a concurrent two-call `updatePanels` test asserts the row lock
  serializes (mirrors the campaigns / schedule revision-bump-first pattern).
- frame CRUD; `createFrame` also makes the `Content` row; `reorderFrames`
  rewrites `sortOrder`; changing a frame's type via `setWebContent` on a former
  `PICTURE` frame deletes the old `Picture` row and sets `Frame.type = WEB`.
- each `set*Content` upserts its typed row and is idempotent.
- `setScreenContentSource`: "canvas" sets `canvasId` and nulls `playlistId`;
  "playlist" the reverse; "none" nulls both; audit row written.

### 10.6 Tenant isolation - `src/test/isolation/tenant-isolation.spec.ts` (extend)

Fixtures `bCanvasId`, `bPanelId`, `bFrameId`, `bWebContentId` in org B. Acting as
org A: every canvas / panel / frame / content action on a B id is refused and
leaves B's rows unchanged; `setScreenContentSource` with a B `canvasId` for an A
screen is refused. RLS raw-SQL backstop: under org A's GUC,
`SELECT count(*) FROM "Web" WHERE "contentId" = '<bWebContentId>'` is 0; same for
`"Canvas"` / `"Panel"` / `"Frame"`.

### 10.7 Component - `src/components/app/canvas/*.test.tsx`

The geometry is unit-tested in 10.1; component tests cover: the frame strip
reorder calls `reorderFrames` with the new order; the content-type menu creates
the right frame; the Web editor rejects a non-URL; the screens content-source
dialog submits the right `source` + id; the panel inspector's numeric inputs call
`updatePanels`. Radix dialogs queried via `document` (portal), per the playlists
preview-dialog test note.

### 10.8 Player route - extend `src/app/api/player/sync/sync.test.ts`

A screen with `canvasId` set and no campaign / schedule -> `source: "canvas"`,
`canvas` object with the assembled panels, `playlist` null. A campaign covering
that screen -> `source: "campaign"`, `canvas` null. A screen whose `canvasId`
points at a deleted canvas -> falls through to the base playlist, 200, no throw.

### 10.9 e2e - `src/test/e2e/canvas.spec.ts`

Register a fresh org, sign in, `/canvas`, New canvas, open the editor, add a
panel, drag it (assert it snapped to the grid via its rendered `left`), add an
Image frame and pick a seeded asset, set a screen to canvas mode from `/screens`,
then assert `GET /api/player/sync` for that screen's device token returns
`source: "canvas"` with one panel and one image frame.

---

## 11. Deliverables

1. `prisma/schema.prisma` + `prisma/migrations/<ts>_canvas_editor/migration.sql`
   (`Canvas.revision` / `archivedAt` / `backgroundImageId` FK, `WEB` enum value,
   `Web` model + FK, `Web` RLS block, the `backgroundImageId` non-cuid cleanup).
2. `prisma/canvas-schema.test.ts` (schema text + live FK/enum behaviour).
3. `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts` (+ `"web"` / `"Web"`).
4. `src/lib/canvas/revision.ts`, `src/lib/canvas/geometry.ts` + tests.
5. `src/lib/validation/canvas.ts` + tests.
6. `src/lib/player/canvas-manifest.ts` + tests; `src/lib/player/campaign.ts`
   canvas tier + extended tests.
7. `src/lib/rbac/policy.ts` + tests; `src/lib/nav.ts` + tests;
   `src/components/app/nav-sidebar.tsx` icon.
8. `src/app/(app)/canvas/actions.ts`; `src/app/(app)/canvas/page.tsx`;
   `src/app/(app)/canvas/[id]/page.tsx`; `src/app/(app)/canvas/canvas.test.ts`.
9. `src/components/app/canvas/{canvas-list,new-canvas-dialog,canvas-editor,canvas-stage,panel-inspector,frame-strip,frame-content-editor,canvas-settings-dialog,canvas-preview-dialog}.tsx` + the tests in 10.7.
10. `src/components/app/screens/screen-content-source-dialog.tsx` +
    `screens-table.tsx` change + `screens.test.ts` extension.
11. `src/app/api/canvas/[id]/preview/route.ts` + test.
12. `src/app/api/player/sync/route.ts` canvas branch + `sync.test.ts` extension.
13. `src/test/isolation/tenant-isolation.spec.ts` extension; `src/test/e2e/canvas.spec.ts`.
14. `scripts/simulate-canvas.ts`.
15. `docs/architecture.md` - Canvas section + roadmap (increment 5 Plan 1 shipped;
    Plan 2 = Weather + News; tenant tables -> 35).

---

## 12. Risks and open questions

- **Editor size.** The WYSIWYG editor is the largest single frontend surface in
  the app. The plan splits it into `canvas-stage` (render + pointer math),
  `panel-inspector`, `frame-strip`, `frame-content-editor` (a switch over 5
  small editors), and pure `geometry.ts` so no one file carries it all. If a
  component still balloons past ~400 lines during the build, that is a signal to
  split further, not to push through.
- **`updatePanels` write amplification.** Every drag / resize / reorder is one
  action call and one `revision` bump. A user dragging a panel around fires one
  call per pointer-up, which is fine; a future "align all" bulk op would want its
  own batched action. Acceptable for Plan 1.
- **`ALTER TYPE ... ADD VALUE` cannot run inside a transaction block** in older
  Postgres; Postgres 18 (the pinned version) allows it, and Prisma's migration
  runner issues it outside the wrapping transaction anyway. If the migration
  fails on the enum add, split it into its own migration file that contains only
  the `ALTER TYPE`.
- **Background image legacy data.** The DM import may have left a non-cuid string
  in `Canvas.backgroundImageId`. The migration nulls anything that is not a
  24-char cuid before adding the FK. If a real import is ever run against this
  schema, the DM importer must map the legacy media ref to a `MediaAsset` id.
- **Clock timezone.** A blank `timeZone` means "screen local", which the device
  resolves from its own OS. The manifest passes `timeZone: null` through; the
  player, not the server, handles the fallback. Documented in the manifest type.
- **Web frame security.** The player renders `WEB` frames in a sandboxed iframe;
  the server only validates the URL is `https?://` and stores it. An operator can
  point a panel at any site. This matches the existing playlist WEB asset type
  and is an accepted operator capability.
