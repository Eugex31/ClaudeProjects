# Visual Canvas Editor (Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Canvas` / `Panel` / `Frame` / `Content` hierarchy authorable through a WYSIWYG editor and playable through `GET /api/player/sync`. Ship five self-contained frame types (Image, Video, Text, Clock, Web iframe), drag / resize / snap-to-grid with alignment guides, a canvas preview player, and screen "content source" switching.

**Architecture:** The hierarchy already exists in the schema (Foundation / Display Monkey import), RLS-forced and tenant-listed. This plan adds `Canvas.revision` (device cache-busting, same pattern as `Playlist.revision`), one `WEB` `FrameType` value, one `Web { url }` typed content model, and turns `Canvas.backgroundImageId` into a real `MediaAsset` FK. `resolveScreenContent` gains a `canvas` tier between the schedule tier and the base-playlist fallback (precedence: campaign > schedule > canvas > base playlist > none). A pure `assembleCanvasManifest` builds the spatial manifest with presigned media URLs; the sync route serves it under `source: "canvas"`. The editor is decomposed into a pure `geometry.ts`, a `canvas-stage` renderer shared by editor / thumbnail / preview, and thin inspector / frame-strip / content-editor components. No new npm dependencies.

**Tech Stack:** Next.js 16.2.11, React 19, Prisma 6.19.x + `@prisma/adapter-pg`, PostgreSQL 18, `zod@^4`, Vitest, Playwright, `date-fns` (already installed).

**Spec:** `docs/specs/2026-09-02-canvas-editor-design.md`

## Global Constraints

- Branch `canvas-editor` off `main` (merge-base at `8fe8a43` `docs: visual canvas editor ... design spec`, already on `main`). Runtime pins unchanged. TypeScript `strict`. No new npm dependencies.
- Every tenant-data read/write goes through `forOrg` / `withOrgTransaction`, EXCEPT the device-authed `src/app/api/player/sync/route.ts` (root `prisma`, in the `src/app/api/player/**` ESLint allow-list) which scopes every read with `organizationId: screen.organizationId`. The session-authed `GET /api/canvas/[id]/preview` route uses `ctx.db`.
- `Web` is the ONE new tenant table. Add it to all three lists: the migration RLS `ARRAY['Web']`, `TENANT_MODELS` (`src/lib/db/tenant.ts`, camelCase `"web"`), `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`, PascalCase `"Web"`). `src/lib/db/tenant-model-list.test.ts` is a set-equality check with NO count literal - it needs no edit but must stay green. 34 -> 35 tenant tables.
- The RLS policy for `Web` is BYTE-IDENTICAL to migration `20260830032500_rls_empty_guc_is_unscoped` / the analytics migration: `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`, both USING and WITH CHECK, `ENABLE` + `FORCE ROW LEVEL SECURITY`. Copy the `DO $$ ... FOREACH t IN ARRAY ARRAY['Web'] ...` block from the tail of `prisma/migrations/20260902120000_analytics/migration.sql`.
- `ALTER TYPE "FrameType" ADD VALUE 'WEB'` must not run inside a transaction with other DDL on some Postgres versions. Put the `ALTER TYPE` FIRST in the migration file, on its own, before any `CREATE TABLE` / `ALTER TABLE`. If Prisma's runner still fails on it, split the enum add into its own migration directory that runs first.
- `Canvas.revision Int @default(1)`; `bumpCanvasRevision(tx, canvasId)` (`src/lib/canvas/revision.ts`) = `tx.canvas.update({ where: { id }, data: { revision: { increment: 1 } } })` is the FIRST statement of every `withOrgTransaction` that mutates a canvas or any descendant (panel, frame, content, typed row). `archiveCanvas` / `restoreCanvas` / `deleteCanvas` / `setScreenContentSource` do NOT bump.
- Every mutating server action: `requireRole(<action>)` first; `safeParse`; resolve every caller-supplied id through `ctx.db` (a miss -> `{ error }` or `NotFoundError`, consistent with campaigns / schedule); `withOrgTransaction` with `bumpCanvasRevision` first where applicable; mutate; `writeAudit(...)`; `revalidatePath("/canvas")` (plus `revalidatePath(\`/canvas/${id}\`)` for editor actions). `createCanvas`'s `redirect("/canvas/<id>")` is outside the try/catch.
- Resolution precedence is fixed: active campaign > matching schedule rule > `Screen.canvasId` (canvas) > `Screen.playlistId` (base playlist) > `{ source: "none" }`. A canvas screen is still taken over by a campaign or schedule rule.
- `assembleCanvasManifest` and `resolveScreenContent` and `geometry.ts` are PURE: no I/O, no `Date.now()`, deterministic. The route injects `signUrl` and the canvas tree.
- RSC boundary: `page.tsx` server components pass only serializable props into `"use client"` children - no `Date` objects (ISO strings), no functions. `updatedAt` etc. as ISO strings.
- Copy rules: no em dashes, no emojis, no exclamation points in any user-facing string, error, toast, log line, audit action, or doc prose. End error strings with a period.
- Geometry: `MIN_PANEL = 16`, `SNAP_TOLERANCE = 8`, default `GRID = 8`, all in canvas px. `snap(v, grid)` with `grid <= 1` is a passthrough (no snap).
- TDD: write the failing test, run it and watch it fail, implement the minimum, run it and watch it pass, commit. Conventional Commits.
- Commands run from `lynesign/`. `npm run db:up` + `npm run storage:up` must both be running for integration / e2e. If Postgres will not start ("not accepting connections"), `rm -f .pgdata/postmaster.pid` then retry.
- `npm run test` truncates the dev DB. After any integration / e2e run, the demo login and `simulate-*` data must be rebuilt before using the app. Run only the focused suites each task names.
- A concurrent session may have uncommitted `tsconfig.json` / `scripts/simulate-account.ts` in the working tree. Not part of this branch. Do not touch or stage them; assess only NEW problems in `src/` / `prisma/`.
- Known baseline: `npm run test` is 558 passing on `main` with services up.

---

## File Structure

```
lynesign/
  prisma/
    schema.prisma                                    # Canvas.revision/archivedAt/backgroundImage FK; WEB enum; Web model
    migrations/<ts>_canvas_editor/migration.sql      # ALTER TYPE first; Canvas cols; Web table + FK + RLS; bg-id cleanup
    canvas-schema.test.ts                            # NEW - schema text + live FK/enum behaviour
  src/
    lib/
      db/tenant.ts                                   # TENANT_MODELS += "web"
      rbac/policy.ts                                 # Action union + POLICY += canvas.*
      rbac/policy.test.ts                            # + canvas.* cases
      nav.ts                                         # /canvas item
      nav.test.ts                                    # + /canvas gate case
      canvas/revision.ts                             # NEW - bumpCanvasRevision
      canvas/geometry.ts                             # NEW - snap, clampPanel, alignmentGuides, nextZIndex, swapZ
      canvas/geometry.test.ts                        # NEW
      validation/canvas.ts                           # NEW - all zod schemas
      validation/canvas.test.ts                      # NEW
      player/canvas-manifest.ts                      # NEW - assembleCanvasManifest, CanvasTree, CanvasManifest
      player/canvas-manifest.test.ts                 # NEW
      player/campaign.ts                             # + canvas input + { source: "canvas" } arm
      player/campaign.test.ts                        # + canvas-tier cases
    test/isolation/tenant-tables.ts                  # TENANT_TABLES += "Web"
    app/
      (app)/canvas/
        actions.ts                                   # NEW - all canvas/panel/frame/content actions
        page.tsx                                     # NEW - list
        [id]/page.tsx                                # NEW - editor server page
        canvas.test.ts                               # NEW - action integration
      (app)/screens/
        actions.ts                                   # + setScreenContentSource
        screens-table.tsx                            # + content-source cell + dialog trigger
        screens.test.ts                              # + setScreenContentSource cases
      api/canvas/[id]/preview/route.ts               # NEW - session-authed canvas manifest
      api/canvas/[id]/preview/preview.test.ts        # NEW
      api/player/sync/route.ts                       # + canvas branch, canvas: null on every other branch
      api/player/sync/sync.test.ts                   # + canvas cases
    components/app/canvas/                            # NEW
      canvas-list.tsx
      new-canvas-dialog.tsx
      canvas-editor.tsx
      canvas-stage.tsx
      panel-inspector.tsx
      frame-strip.tsx
      frame-content-editor.tsx
      canvas-settings-dialog.tsx
      canvas-preview-dialog.tsx
      canvas-editor.test.tsx
      frame-strip.test.tsx
      frame-content-editor.test.tsx
    components/app/screens/
      screen-content-source-dialog.tsx              # NEW
      screen-content-source-dialog.test.tsx         # NEW
    components/app/nav-sidebar.tsx                    # ICONS += canvas
  docs/architecture.md                               # + Canvas section, roadmap update
  scripts/simulate-canvas.ts                          # NEW - demo data (excluded from typecheck)
  src/test/isolation/tenant-isolation.spec.ts        # + canvas cross-org cases + RLS backstop
  src/test/e2e/canvas.spec.ts                         # NEW
```

---

## Task 1: Schema, migration, RLS, tenant lists

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts`
- Create: `prisma/migrations/<ts>_canvas_editor/migration.sql`, `prisma/canvas-schema.test.ts`
- Existing test that must stay green: `src/lib/db/tenant-model-list.test.ts`

**Interfaces:**
- Produces:
  - `Canvas` gains `revision Int @default(1)`, `archivedAt DateTime? @db.Timestamptz(3)`, and `backgroundImageId` becomes an FK: `backgroundImage MediaAsset? @relation("CanvasBackground", fields: [backgroundImageId], references: [id], onDelete: SetNull)` + `MediaAsset.canvasBackgrounds Canvas[] @relation("CanvasBackground")`. New `@@index([organizationId, archivedAt])`.
  - `enum FrameType` gains `WEB` (appended).
  - `model Web { contentId String @id; organizationId String; url String; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }` + `Content.web Web?`.
  - `TENANT_MODELS` gains `"web"`; `TENANT_TABLES` gains `"Web"`.

- [ ] **Step 1: schema text test (write, run, fail)** -- `prisma/canvas-schema.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const schema = readFileSync("prisma/schema.prisma", "utf8");
const block = (n: string) => schema.match(new RegExp(`model ${n} \\{[\\s\\S]*?\\n\\}`))![0];
describe("canvas editor schema", () => {
  it("Canvas has revision and archivedAt", () => {
    const b = block("Canvas");
    expect(b).toMatch(/revision\s+Int\s+@default\(1\)/);
    expect(b).toMatch(/archivedAt\s+DateTime\?/);
  });
  it("Canvas.backgroundImage is a SetNull FK", () => {
    expect(block("Canvas")).toMatch(/backgroundImage\s+MediaAsset\?\s+@relation\([^)]*onDelete:\s*SetNull/);
  });
  it("FrameType has WEB", () => {
    expect(schema).toMatch(/enum FrameType \{[\s\S]*\bWEB\b[\s\S]*\}/);
  });
  it("Web model exists with url and cascade", () => {
    const b = block("Web");
    expect(b).toMatch(/url\s+String/);
    expect(b).toMatch(/content\s+Content\s+@relation\([^)]*onDelete:\s*Cascade/);
  });
});
```
Run: `npx vitest run prisma/canvas-schema.test.ts` -- FAIL.

- [ ] **Step 2: edit `prisma/schema.prisma`** per Interfaces. Place `model Web` right after `model Html` (near the other typed content rows).

- [ ] **Step 3: generate the migration SQL, do not apply** -- `npx prisma migrate dev --name canvas_editor --create-only`. If the embedded Postgres has no shadow DB and it fails, use `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<YYYYMMDDHHMMSS>_canvas_editor/migration.sql` (timestamp a few seconds after `20260902120005`).

- [ ] **Step 4: hand-edit the migration SQL** so the order is:
  1. `ALTER TYPE "FrameType" ADD VALUE 'WEB';` -- FIRST, alone.
  2. The `Canvas` column adds (`revision`, `archivedAt`), the `Canvas_organizationId_archivedAt_idx` index.
  3. `UPDATE "Canvas" SET "backgroundImageId" = NULL WHERE "backgroundImageId" IS NOT NULL AND length("backgroundImageId") <> 25;` -- clear any legacy non-cuid ref before the FK. (A comment: the DM import stored a legacy media-ref string here.)
  4. `ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_backgroundImageId_fkey" FOREIGN KEY ("backgroundImageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;`
  5. `CREATE TABLE "Web" (...)` + its PK + the `Web_contentId_fkey` FK (`ON DELETE CASCADE`).
  6. The `DO $$ ... FOREACH t IN ARRAY ARRAY['Web'] ...` RLS block, predicate byte-identical to the analytics migration.
  If the runner rejected the `ALTER TYPE` alongside other DDL, move step 1 into its own earlier migration dir (`<ts-1>_frametype_web`) containing only that line.

- [ ] **Step 5: apply** -- `npx prisma migrate deploy` then `npx prisma generate`. Expect: clean apply, `web` delegate on the client.

- [ ] **Step 6: sync the tenant lists** -- `TENANT_MODELS += "web"`; `TENANT_TABLES += "Web"`. Do not touch `tenant-model-list.test.ts`; confirm it stays green.

- [ ] **Step 7: live FK/enum behaviour test (write, run, pass)** -- extend `prisma/canvas-schema.test.ts` with a `describe` using the root `prisma` client against the dev DB (mirror `prisma/analytics-schema.test.ts`):
  - a `Frame` can be created with `type: "WEB"`.
  - creating a `Web` row for a `Content`, then deleting the `Content`, cascades the `Web` row away.
  - setting `Canvas.backgroundImageId` to a real `MediaAsset` id works; deleting that asset nulls `Canvas.backgroundImageId` (SetNull) and leaves the canvas.
  Clean up in `afterEach`. Run: `npx vitest run prisma/canvas-schema.test.ts` -- PASS.

- [ ] **Step 8: regression** -- `npx vitest run src/lib/db/` -- PASS.

- [ ] **Step 9: Commit** -- `git add -A && git commit -m "feat: canvas revision, Web frame type, background image FK, RLS"`

---

## Task 2: RBAC, nav, sidebar icon

**Files:**
- Modify: `src/lib/rbac/policy.ts`, `src/lib/nav.ts`, `src/components/app/nav-sidebar.tsx`
- Test: `src/lib/rbac/policy.test.ts`, `src/lib/nav.test.ts`

**Interfaces:**
- Produces: `Action` union + `POLICY` gain `canvas.view` (`ALL`), `canvas.create` / `canvas.update` / `canvas.delete` (`CONTENT_UP` - the same constant `playlist.create` uses). `nav.ts` gains `{ href: "/canvas", label: "Canvas", icon: "canvas", action: "canvas.view" }` immediately after the `/playlists` entry. `nav-sidebar.tsx` `ICONS` map gains `canvas: LayoutGrid` (import `LayoutGrid` from `lucide-react`).

- [ ] **Step 1: policy test (write, run, fail)** -- mirror the `playlist.*` cases: `CONTENT_MANAGER` can `canvas.view` and `canvas.create`; `VIEWER` can only `canvas.view`; `MANAGER` can all four. Run: `npx vitest run src/lib/rbac/policy.test.ts` -- FAIL.

- [ ] **Step 2: add the actions** -- next to `playlist.*`, reusing `ALL` / `CONTENT_UP`.

- [ ] **Step 3: run policy test** -- PASS.

- [ ] **Step 4: nav test (write, run, fail)** -- assert the `/canvas` item has `action: "canvas.view"` and sits after `/playlists`. Run: `npx vitest run src/lib/nav.test.ts` -- FAIL.

- [ ] **Step 5: edit `nav.ts` + `nav-sidebar.tsx`** -- add the nav item and the icon mapping.

- [ ] **Step 6: run nav + rbac + a component smoke** -- `npx vitest run src/lib/rbac/ src/lib/nav.test.ts` -- PASS. `npm run typecheck` clean.

- [ ] **Step 7: Commit** -- `git commit -am "feat: canvas.* RBAC, nav entry, sidebar icon"`

---

## Task 3: Pure geometry helpers -- `src/lib/canvas/geometry.ts`

**Files:**
- Create: `src/lib/canvas/geometry.ts`, `src/lib/canvas/geometry.test.ts`

**Interfaces:**
- Produces:
  - `export const MIN_PANEL = 16; export const SNAP_TOLERANCE = 8; export const DEFAULT_GRID = 8;`
  - `export type Rect = { x: number; y: number; width: number; height: number };`
  - `export function snap(value: number, grid: number): number` -- nearest multiple of `grid`; `grid <= 1` returns `value` unchanged. Handles negatives.
  - `export function clampPanel(rect: Rect, canvas: { width: number; height: number }): Rect` -- enforces `width`/`height` >= `MIN_PANEL`; keeps at least `MIN_PANEL` of the panel inside `[0, canvas.width] x [0, canvas.height]` (a panel may hang off an edge but not fully leave).
  - `export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };`
  - `export function alignmentGuides(moving: Rect, others: Rect[], canvas: { width: number; height: number }, tolerance: number): { dx: number; dy: number; guides: Guide[] }` -- for `moving`'s left / centerX / right vs every `others` rect's and the canvas's left(0) / centerX / right(width), and the y-equivalents, find the single smallest-magnitude snap within `tolerance` per axis; return the offset (`dx` / `dy`, 0 when no snap) and the `Guide` lines to draw. Deterministic tie-break: smallest `abs(delta)`, then lowest candidate coordinate.
  - `export function nextZIndex(panels: { zIndex: number }[]): number` -- `max + 1`, or `0` for empty.
  - `export function swapZ<T extends { id: string; zIndex: number }>(panels: T[], id: string, dir: "forward" | "back"): T[]` -- swaps the target's `zIndex` with its nearest neighbour in that direction; returns a new array; no-op at the end.

- [ ] **Step 1: write `geometry.test.ts` (run, fail)** -- cover:
  - `snap`: `snap(11, 8) === 8`, `snap(13, 8) === 16`, `snap(-3, 8) === 0`, `snap(-13, 8) === -16`, `snap(11, 1) === 11`, `snap(11, 0) === 11`.
  - `clampPanel`: a `10x10` rect -> `width`/`height` become `16`; a rect at `x: -100` on a `1920` canvas -> `x` becomes `MIN_PANEL - width` (so `MIN_PANEL` stays visible); a rect fully inside is unchanged; a rect at `x: 1900` on `1920` stays (partly off the right edge is allowed).
  - `alignmentGuides`: moving left edge 3px from another rect's left -> `dx === -3` and one `x` guide; moving centerX 2px from canvas centerX -> `dx` snaps to canvas center; moving 20px from everything with `tolerance: 8` -> `dx === 0`, `guides: []`; x and y snap independently; the tie-break (two candidates equidistant -> the lower coordinate wins).
  - `nextZIndex([]) === 0`, `nextZIndex([{zIndex:0},{zIndex:5}]) === 6`.
  - `swapZ`: forward on the top panel is a no-op; back on the bottom is a no-op; a middle panel swaps with the correct neighbour and the array identity changes.
  Run: `npx vitest run src/lib/canvas/geometry.test.ts` -- FAIL.

- [ ] **Step 2: implement `geometry.ts`**.

- [ ] **Step 3: run the test + typecheck** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: pure canvas geometry helpers"`

---

## Task 4: Validation -- `src/lib/validation/canvas.ts`

**Files:**
- Create: `src/lib/validation/canvas.ts`, `src/lib/validation/canvas.test.ts`

**Interfaces:**
- Produces, per spec section 5:
  - `idSchema`, `createCanvasSchema`, `updateCanvasSchema`, `panelSchema`, `createPanelSchema`, `updatePanelsSchema`, `frameSchema` (its `type` `z.enum(["CLOCK","PICTURE","VIDEO","MEMO","WEB"])`), `createFrameSchema`, `reorderFramesSchema`, `setFrameDurationSchema`, `imageContentSchema` (`mode` `z.enum(["cover","contain","fill","none"]).optional()`), `videoContentSchema`, `textContentSchema` (`{ frameId, body: z.string().max(5000) }`), `clockContentSchema` (`{ frameId, style: z.number().int().min(0).max(3), showDate, showTime, showSeconds: z.boolean(), label: z.string().max(40).optional(), timeZone: z.string().max(64).optional() }`), `webContentSchema` (`{ frameId, url: z.string().url().max(2048) }`), `setScreenContentSourceSchema` (`{ screenId, source: z.enum(["playlist","canvas","none"]), playlistId: cuid.optional(), canvasId: cuid.optional() }` + `.refine`: playlist requires `playlistId`, canvas requires `canvasId`, none forbids both).
  - Colors: `backgroundColor` `z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()`.
  - Sizes: `width`/`height` `z.number().int().min(240).max(7680)` (canvas); panel `x`/`y` `z.number().int().min(-10000).max(20000)`, `width`/`height` `z.number().int().min(1).max(20000)`, `zIndex` `z.number().int().min(0).max(9999)`.

- [ ] **Step 1: write `canvas.test.ts` (run, fail)** -- accept/reject for each schema. Emphasise: `setScreenContentSourceSchema` (each `source` value: `"canvas"` without `canvasId` fails; `"none"` with `playlistId` fails; `"playlist"` with `playlistId` passes); `updatePanelsSchema` (an array of `{ id } & Partial<panel>`, `min(1)`, `max(200)`); `webContentSchema` rejects `"not-a-url"` and `"ftp://x"` wait `z.string().url()` accepts ftp -- add `.refine((u) => /^https?:\/\//i.test(u), "The URL must start with http or https.")`; `clockContentSchema` rejects `style: 4`. Run: `npx vitest run src/lib/validation/canvas.test.ts` -- FAIL.

- [ ] **Step 2: implement `canvas.ts`** (add the `https?` refine to `webContentSchema`).

- [ ] **Step 3: run the test + typecheck** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: canvas validation schemas"`

---

## Task 5: `bumpCanvasRevision` + `assembleCanvasManifest`

**Files:**
- Create: `src/lib/canvas/revision.ts`, `src/lib/player/canvas-manifest.ts`, `src/lib/player/canvas-manifest.test.ts`

**Interfaces:**
- Produces:
  - `export function bumpCanvasRevision(tx: TenantTransactionClient, canvasId: string): Promise<unknown>` -- `tx.canvas.update({ where: { id: canvasId }, data: { revision: { increment: 1 } } })`. Mirror `src/lib/playlists/revision.ts`.
  - `src/lib/player/canvas-manifest.ts` per spec section 3.3: `CanvasTree` input type, `CanvasManifest` output type, `assembleCanvasManifest(tree: CanvasTree, signUrl: (storageKey: string) => string): CanvasManifest`.
- Consumed by Task 7 (test fixtures reference the manifest shape), Task 11+ (editor / preview render), Task 16 (sync route).

- [ ] **Step 1: write `canvas-manifest.test.ts` (run, fail)** -- build a `CanvasTree` literal in the test:
  - 3 panels with `zIndex` `[2, 0, 1]` -> output panels ordered `[0, 1, 2]`; same-`zIndex` tie -> `id` asc.
  - a panel's frames with `sortOrder` `[1, 0, 2]` -> ordered `[0, 1, 2]`; tie -> `id` asc.
  - drop rules: a frame with `type: "HTML"` is dropped; `content: null` dropped; `PICTURE` with `asset: null` dropped; `PICTURE` with `asset.status: "PROCESSING"` dropped; `PICTURE` with `asset.archivedAt` set dropped; `PICTURE` with `storageKey: null` dropped; `WEB` with `url: ""` dropped; `MEMO` with `body: ""` dropped; `CLOCK` with everything false is KEPT.
  - a panel whose every frame is dropped is itself absent from the output.
  - `signUrl` is called once per distinct `storageKey` (image, video, background) and its return is placed on `frames[].image.url` / `.video.url` / `background.imageUrl`.
  - `kind` lowercasing: `PICTURE -> "image"`, `VIDEO -> "video"`, `MEMO -> "text"`, `CLOCK -> "clock"`, `WEB -> "web"`.
  - `durationSeconds` and clock `style` pass through unchanged; a `VIDEO` frame with `durationSeconds: 0` stays `0`.
  Run: `npx vitest run src/lib/player/canvas-manifest.test.ts` -- FAIL.

- [ ] **Step 2: implement `revision.ts` and `canvas-manifest.ts`**.

- [ ] **Step 3: run the test + typecheck** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: bumpCanvasRevision and assembleCanvasManifest"`

---

## Task 6: `resolveScreenContent` canvas tier

**Files:**
- Modify: `src/lib/player/campaign.ts`
- Test: `src/lib/player/campaign.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new at runtime (the route loads the tree).
- Produces:
  - `ScreenContent` union gains `| { source: "canvas"; canvasId: string }`.
  - `resolveScreenContent` arg gains `canvas?: { canvasId: string } | null`.
  - Resolution order: campaign winner (unchanged) -> matching schedule (unchanged) -> `args.canvas != null` -> `{ source: "canvas", canvasId: args.canvas.canvasId }` -> `screen.playlistId` -> `none`.

- [ ] **Step 1: extend `campaign.test.ts` (run, fail)** -- a `describe("canvas tier")`:
  - `canvas` provided, no campaign, no schedule -> `source: "canvas"`, `canvasId` echoed.
  - campaign wins + `canvas` provided -> `source: "campaign"`.
  - schedule wins + `canvas` provided -> `source: "schedule"`.
  - `canvas: null` + `screen.playlistId` set -> `source: "playlist"` (unchanged).
  - `canvas` provided AND `screen.playlistId` set, no campaign/schedule -> `source: "canvas"` (canvas is checked first).
  - `canvas` omitted (`undefined`) -> same as `null`.
  Run: `npx vitest run src/lib/player/campaign.test.ts` -- FAIL.

- [ ] **Step 2: implement** -- add the union arm; insert the `if (args.canvas != null) return { source: "canvas", canvasId: args.canvas.canvasId };` between the schedule block and the `screen.playlistId` block. Update the file header comment to name all four content tiers plus none.

- [ ] **Step 3: run the test + typecheck** -- PASS (the sync route still compiles; it does not yet pass `canvas`).

- [ ] **Step 4: Commit** -- `git commit -am "feat: resolveScreenContent canvas tier"`

---

## Task 7: Canvas CRUD actions

**Files:**
- Create: `src/app/(app)/canvas/actions.ts` (canvas-level actions only in this task), `src/app/(app)/canvas/canvas.test.ts`

**Interfaces:**
- Consumes: `bumpCanvasRevision` (Task 5), `requireRole`, `withOrgTransaction`, `writeAudit`, `NotFoundError`, `createCanvasSchema` / `updateCanvasSchema` / `idSchema` (Task 4).
- Produces (all return `{ id: string } | { error: string }` unless noted; header comment modelled on `campaigns/actions.ts` -- state that archive/restore/delete do NOT bump `revision` and why):
  - `createCanvas(input: { name; width; height; backgroundColor?; backgroundImageId? })` -- creates the row (no auto panel), audits `canvas.create`, `redirect("/canvas/<id>")` OUTSIDE try/catch.
  - `updateCanvas(id, patch)` -- bump first; apply name / size / background; shrinking size does NOT delete panels; audit `canvas.update`.
  - `duplicateCanvas(id)` -- deep copy: new `Canvas` (`revision: 1`, `legacyId: null`, name `"<name> copy"`), then every `Panel`, every `Frame`, every `Content` + its one typed row, all with fresh ids, `sortOrder` / `zIndex` preserved. Audit `canvas.duplicate`. Done in one `withOrgTransaction`.
  - `archiveCanvas(id)` / `restoreCanvas(id)` -- `{ ok: true } | { error }`; set / clear `archivedAt`; NO bump; audit `canvas.archive` / `canvas.restore`.
  - `deleteCanvas(id)` -- `{ ok: true } | { error }`; refused when `ctx.db.screen.count({ where: { canvasId: id } }) > 0` -> `{ error: "That canvas is assigned to N screens. Change their content source first." }` (interpolate the count); else cascade-delete; NO bump; audit `canvas.delete`.

- [ ] **Step 1: `canvas.test.ts` (write, run, fail)** -- real DB, ctx-mock from `campaigns.test.ts`. Seed an org + OWNER user + a media asset. Cases:
  - `createCanvas` returns `{ id }`, row `revision: 1`, audit `canvas.create` written.
  - `updateCanvas` changing `width` bumps `revision` to 2; a concurrent two-call `updateCanvas` in `Promise.all` ends `revision === 3`, one consistent row (mirrors campaigns IMP-1).
  - `duplicateCanvas` on a canvas with 2 panels / 3 frames / 3 content rows -> the copy has 2 panels / 3 frames / 3 content rows with NEW ids, `revision: 1`, name ends `" copy"`.
  - `archiveCanvas` / `restoreCanvas` do NOT change `revision`.
  - `deleteCanvas` refused while a screen has `canvasId` set; succeeds after the screen's `canvasId` is nulled; cascade removed the panels / frames / content.
  Run: `npx vitest run "src/app/(app)/canvas/canvas.test.ts"` -- FAIL.

- [ ] **Step 2: implement the canvas-level actions in `actions.ts`**.

- [ ] **Step 3: run the test + typecheck + lint** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: canvas CRUD actions with revision bump and screen guard"`

---

## Task 8: Panel and frame actions

**Files:**
- Modify: `src/app/(app)/canvas/actions.ts`
- Test: `src/app/(app)/canvas/canvas.test.ts` (extend)

**Interfaces:**
- Consumes: `createPanelSchema` / `updatePanelsSchema` / `createFrameSchema` / `reorderFramesSchema` / `setFrameDurationSchema` (Task 4), `bumpCanvasRevision`.
- Produces (`canvas.update` role; `{ id } | { error }` or `{ ok: true } | { error }`; each opens `withOrgTransaction` with `bumpCanvasRevision(tx, <the owning canvasId>)` first -- resolve the canvasId from the panel / frame):
  - `createPanel({ canvasId, name?, x, y, width, height, zIndex, noScroll })` -- `{ id }`.
  - `updatePanels(canvasId, { panels: [{ id, ...partial geometry / name / zIndex / noScroll }] })` -- `{ ok: true }`; applies each panel's patch; ONE bump for the batch.
  - `deletePanel(id)` -- cascade; `{ ok: true }`.
  - `duplicatePanel(id)` -- copies the panel + its frames + content, offset `x`/`y` by `DEFAULT_GRID`; `{ id }`.
  - `createFrame({ panelId, type, durationSeconds })` -- creates the `Frame` AND an empty `Content` row (`frameId` set), `sortOrder` = current max + 1 for that panel; `{ id }` (the frame id).
  - `reorderFrames({ panelId, frameIds })` -- rewrites `sortOrder` to the index in `frameIds`; `{ ok: true }`. Reject (`{ error }`) if `frameIds` is not exactly the panel's current frame id set.
  - `setFrameDuration({ id, durationSeconds })` -- `{ ok: true }`.
  - `deleteFrame(id)` -- cascade removes `Content` + any typed row; `{ ok: true }`.

- [ ] **Step 1: extend `canvas.test.ts` (write, run, fail)**:
  - `createPanel` -> row exists, `revision` bumped.
  - `updatePanels` with two panels' geometry -> both applied, `revision` bumped ONCE (assert delta of 1 across the call).
  - a concurrent two-call `updatePanels` -> serialized, final `revision` consistent.
  - `createFrame` -> `Frame` + `Content` both exist, `sortOrder` correct; a second `createFrame` on the same panel gets `sortOrder` +1.
  - `reorderFrames` with a valid permutation -> `sortOrder` rewritten; with a wrong id set -> `{ error }`, nothing changed.
  - `deletePanel` cascades frames + content; `duplicatePanel` deep-copies with new ids and the grid offset.
  Run: `npx vitest run "src/app/(app)/canvas/canvas.test.ts"` -- FAIL then PASS.

- [ ] **Step 2: implement the panel + frame actions**.

- [ ] **Step 3: run + typecheck + lint** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: canvas panel and frame actions"`

---

## Task 9: Content upsert actions

**Files:**
- Modify: `src/app/(app)/canvas/actions.ts`
- Test: `src/app/(app)/canvas/canvas.test.ts` (extend)

**Interfaces:**
- Consumes: `imageContentSchema` / `videoContentSchema` / `textContentSchema` / `clockContentSchema` / `webContentSchema` (Task 4), `bumpCanvasRevision`.
- Produces (`canvas.update`; `{ ok: true } | { error }`; `bumpCanvasRevision` first, canvasId resolved via `frame -> panel -> canvasId`):
  - `setImageContent({ frameId, mediaAssetId, mode? })` -- resolves `mediaAssetId` through `ctx.db` (must be a `READY` `IMAGE` asset in the org, else `{ error }`); sets `Frame.type = "PICTURE"`; deletes any other typed row on the frame's `Content`; upserts `Picture { mediaAssetId, mode }`.
  - `setVideoContent({ frameId, mediaAssetId })` -- same, `VIDEO` asset, `Frame.type = "VIDEO"`, upserts `Video`.
  - `setTextContent({ frameId, body })` -- `Frame.type = "MEMO"`; upserts `Memo { body }`.
  - `setClockContent({ frameId, style, showDate, showTime, showSeconds, label?, timeZone? })` -- `Frame.type = "CLOCK"`; upserts `Clock { type: style, showDate, showTime, showSeconds, label, timeZone }`.
  - `setWebContent({ frameId, url })` -- `Frame.type = "WEB"`; upserts `Web { url }`.
  Each: when it changes the frame's type, the OLD typed row (e.g. a former `Picture`) is deleted so a `Content` never has two typed rows.

- [ ] **Step 1: extend `canvas.test.ts` (write, run, fail)**:
  - `setImageContent` with a valid `IMAGE` asset -> `Picture` row present, `Frame.type === "PICTURE"`, `revision` bumped; with a `VIDEO` asset id -> `{ error }`; with a cross-type or archived asset -> `{ error }`.
  - `setWebContent` on a frame that was `PICTURE` -> the `Picture` row is gone, a `Web` row exists, `Frame.type === "WEB"`.
  - `setClockContent` upserts `Clock` and is idempotent (call twice, one row, second call still `{ ok: true }`).
  - `setTextContent` with `body: ""` -> `{ ok: true }`, `Memo.body === ""` (the manifest, not the action, drops empties).
  Run: `npx vitest run "src/app/(app)/canvas/canvas.test.ts"` -- FAIL then PASS.

- [ ] **Step 2: implement the content actions**.

- [ ] **Step 3: run + typecheck + lint** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: canvas frame content upsert actions"`

---

## Task 10: `setScreenContentSource` + screens integration

**Files:**
- Modify: `src/app/(app)/screens/actions.ts`, `src/app/(app)/screens/screens-table.tsx`
- Create: `src/components/app/screens/screen-content-source-dialog.tsx`, `src/components/app/screens/screen-content-source-dialog.test.tsx`
- Test: `src/app/(app)/screens/screens.test.ts` (extend)

**Interfaces:**
- Consumes: `setScreenContentSourceSchema` (Task 4).
- Produces:
  - `setScreenContentSource({ screenId, source, playlistId?, canvasId? })` in `screens/actions.ts` -- `requireRole("screen.update")`; `safeParse`; resolve `screenId` and the referenced `playlistId` / `canvasId` through `ctx.db` (non-archived); in `withOrgTransaction` set `{ playlistId: source === "playlist" ? playlistId : null, canvasId: source === "canvas" ? canvasId : null }`; audit `screen.setContentSource`; `revalidatePath("/screens")`. NO canvas revision bump. Returns `{ ok: true } | { error }`.
  - `<ScreenContentSourceDialog>` (`"use client"`): props `{ open; onOpenChange; screen: { id; name; playlistId; canvasId }; playlists: { id; name }[]; canvases: { id; name }[] }`. A radio (Playlist / Canvas / None) + the matching `<select>`; submits `setScreenContentSource`; on `{ error }` keeps open + toast; on success closes + `router.refresh()`.
  - `screens-table.tsx`: a "Content source" cell showing `Playlist: <name>` / `Canvas: <name>` / `None` (needs the page to `include` / select the related names and pass the org's playlist + canvas lists), and a row action opening the dialog. Gated on `can(ctx.actor, "screen.update")`.

- [ ] **Step 1: extend `screens.test.ts` (write, run, fail)** -- `setScreenContentSource`:
  - `source: "canvas"` with a valid `canvasId` -> screen row has `canvasId` set, `playlistId` null, audit `screen.setContentSource`.
  - `source: "playlist"` -> the reverse.
  - `source: "none"` -> both null.
  - a `canvasId` from another org -> `{ error }`, screen unchanged.
  - `source: "canvas"` with no `canvasId` -> `{ error }` (schema refine).
  Run: `npx vitest run "src/app/(app)/screens/screens.test.ts"` -- FAIL.

- [ ] **Step 2: implement the action**.

- [ ] **Step 3: dialog test (write, run, fail)** -- render with a screen in playlist mode; switching the radio to Canvas and picking a canvas then submitting calls `setScreenContentSource` with `{ source: "canvas", canvasId }`; "None" submits `{ source: "none" }`. Mock the action module. Run: `npx vitest run src/components/app/screens/screen-content-source-dialog.test.tsx` -- FAIL.

- [ ] **Step 4: implement the dialog + wire the screens table cell + page data**.

- [ ] **Step 5: run the screens + component suites + typecheck** -- PASS / clean.

- [ ] **Step 6: Commit** -- `git commit -am "feat: screen content source switching between playlist and canvas"`

---

## Task 11: `/canvas` list page

**Files:**
- Modify: `src/app/(app)/canvas/page.tsx` (create)
- Create: `src/components/app/canvas/canvas-list.tsx`, `src/components/app/canvas/new-canvas-dialog.tsx`

**Interfaces:**
- Consumes: `requireRole("canvas.view")`, `can`, the canvas actions (Task 7).
- Produces:
  - `CanvasPage` server component. Loads non-archived canvases (`id, name, width, height, updatedAt, revision`, `_count: { screens: true }`, and enough of `panels -> frames -> content` for a first-frame static thumbnail -- OR skip the thumbnail's media and render a simple wireframe of panel rects for the list; DECISION: list renders a lightweight wireframe (panel rectangles at scale, no media) to avoid presigning URLs for every card. The full media thumbnail is deferred to the editor / preview). An "archived" toggle re-queries with `archivedAt: { not: null }`.
  - `<CanvasList>` (`"use client"` only if it holds the archived toggle state; otherwise server): cards with the wireframe, name, `${width} x ${height}`, "Used by N screens", relative updated-at; per-card Edit link, Duplicate, Archive/Restore, Delete (confirm dialog; shows the guard message inline when blocked). Gated on `can(...)`.
  - `<NewCanvasDialog>` (`"use client"`): name + a size radio (1920x1080 / 1080x1920 / 3840x2160 / Custom with two number inputs). Calls `createCanvas`; on success the action redirects.

- [ ] **Step 1: implement `page.tsx` + `canvas-list.tsx` + `new-canvas-dialog.tsx`** (no dedicated page unit test, matching `campaigns/page.tsx`; the dialog gets a small test).

- [ ] **Step 2: dialog test (write, run, fail, pass)** -- `new-canvas-dialog.test.tsx`: picking "Portrait" then submitting calls `createCanvas` with `{ name, width: 1080, height: 1920 }`; "Custom" shows the number inputs. Run: `npx vitest run src/components/app/canvas/new-canvas-dialog.test.tsx`.

- [ ] **Step 3: typecheck + lint** -- clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: /canvas list page and new-canvas dialog"`

---

## Task 12: Editor -- stage, shell, panel drag / resize / snap

**Files:**
- Create: `src/app/(app)/canvas/[id]/page.tsx`, `src/components/app/canvas/canvas-editor.tsx`, `src/components/app/canvas/canvas-stage.tsx`
- Create: `src/components/app/canvas/canvas-editor.test.tsx`

**Interfaces:**
- Consumes: `geometry.ts` (Task 3), the panel actions (`createPanel` / `updatePanels` / `deletePanel` / `duplicatePanel`, Task 8).
- Produces:
  - `CanvasEditorPage` server component: loads the full tree through `ctx.db` (`canvas -> panels (orderBy zIndex asc) -> frames (orderBy sortOrder asc) -> content -> {clock,picture,video,memo,web}`), serializes it (ISO dates, no functions), passes `canManage = can(ctx.actor, "canvas.update")` and the org's `READY` media assets (`id, name, kind, thumbnailUrl`) for the pickers. Renders `<CanvasEditor tree={...} assets={...} canManage={...} />`.
  - `<CanvasStage>` (pure-ish client): props `{ canvas: { width; height; backgroundColor; backgroundImageUrl }, panels: PanelVM[], scale: number, selectedPanelId: string | null, gridSize: number, showGrid: boolean, guides: Guide[], mode: "edit" | "thumb" | "play", onPanelPointerDown?, renderFrame?: (panel) => ReactNode }`. Renders the scaled canvas box, the grid overlay, each panel as an absolutely positioned div (in `mode: "edit"` with a selection ring + 8 resize handles when selected), the guide lines, and `renderFrame(panel)` inside each panel.
  - `<CanvasEditor>` (`"use client"`): holds the full editor state (panels VM, selection, grid size, show-grid). Wires pointer drag on `<CanvasStage>` panels: translate pointer delta by `1/scale`, apply `snap` + `alignmentGuides` (from `geometry.ts`), keep guides in state during the drag, `clampPanel` on drop, then call `updatePanels(canvasId, { panels: [movedPanel] })` and reconcile (on `{ error }` revert + toast). Resize handles do the same for the moved edges. Arrow-key nudge (1px) / shift-arrow (grid). "Add panel" -> `createPanel` with a default `160x120` rect at `snap(20)`, then select it. Delete key / button -> `deletePanel` (inline confirm if the panel has frames). A grid-size control (1 / 8 / 16 / 32) and a show-grid toggle. Left rail: a panel list (name / size) that also selects. The frame strip and inspector are added in Task 13 (leave slots / props).

- [ ] **Step 1: `canvas-editor.test.tsx` (write, run, fail)** -- render `<CanvasEditor>` with a 2-panel tree at a known scale. Assert:
  - both panels render at their scaled `left`/`top`.
  - a `pointerdown` + `pointermove` on panel A by a delta that lands near the grid calls `updatePanels` on `pointerup` with panel A's snapped `x`/`y` (mock the action).
  - a `pointermove` that brings panel A's left edge within `SNAP_TOLERANCE` of panel B's left edge snaps `x` to match and a guide line is in the DOM.
  - "Add panel" calls `createPanel`.
  - selecting a panel and pressing ArrowRight calls `updatePanels` with `x + 1`.
  Run: `npx vitest run src/components/app/canvas/canvas-editor.test.tsx` -- FAIL.

- [ ] **Step 2: implement `canvas-stage.tsx` then `canvas-editor.tsx` then `page.tsx`** -- keep each file focused; if `canvas-editor.tsx` passes ~400 lines, extract the pointer-drag logic into a `useCanvasDrag` hook in the same directory and note it.

- [ ] **Step 3: run the editor test + typecheck + lint** -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: canvas editor stage with panel drag, resize, and snap"`

---

## Task 13: Editor -- panel inspector, frame strip, content editors, settings

**Files:**
- Create: `src/components/app/canvas/panel-inspector.tsx`, `src/components/app/canvas/frame-strip.tsx`, `src/components/app/canvas/frame-content-editor.tsx`, `src/components/app/canvas/canvas-settings-dialog.tsx`
- Create: `src/components/app/canvas/frame-strip.test.tsx`, `src/components/app/canvas/frame-content-editor.test.tsx`
- Modify: `src/components/app/canvas/canvas-editor.tsx` (mount the new panels)

**Interfaces:**
- Consumes: the frame actions (`createFrame` / `reorderFrames` / `setFrameDuration` / `deleteFrame`, Task 8), the content actions (`setImageContent` / `setVideoContent` / `setTextContent` / `setClockContent` / `setWebContent`, Task 9), `updateCanvas` (Task 7), `nextZIndex` / `swapZ` (Task 3), `<AddMediaDialog>`-style pattern.
- Produces:
  - `<PanelInspector>` (`"use client"`): props `{ panel, onChange: (patch) => void /* local */, onCommit: () => void /* calls updatePanels */, onDelete, onDuplicate, onZ: (dir) => void }`. Numeric `x`/`y`/`width`/`height`/`zIndex`, `name`, `noScroll`; "Bring forward" / "Send back" (call `updatePanels` with the two swapped `zIndex`es via `swapZ`); "Duplicate panel" -> `duplicatePanel`; "Delete panel".
  - `<FrameStrip>` (`"use client"`): props `{ panelId, frames: FrameVM[], selectedFrameId, onSelectFrame, canManage }`. Ordered chips (type icon + label + `${durationSeconds}s`); drag to reorder -> `reorderFrames`; "Add frame" type menu (Image / Video / Text / Clock / Web) -> `createFrame` then select the new frame; per-chip duration input -> `setFrameDuration`; delete -> `deleteFrame`.
  - `<FrameContentEditor>` (`"use client"`): props `{ frame: FrameVM, assets }`. A `switch` on `frame.type` rendering ONE of five small editors:
    - Image / Video: a picker (filter `assets` to `IMAGE` / `VIDEO`), current asset name + thumb; Image adds a `mode` select. -> `setImageContent` / `setVideoContent`.
    - Text: a `<textarea>` bound to `body`, debounced or on-blur -> `setTextContent`.
    - Clock: `style` select (0..3 with a one-line label each), three switches, `label` input, `timeZone` select (a short IANA list + blank = screen local), a live `date-fns`-formatted preview. -> `setClockContent`.
    - Web: URL input (`https?` validated inline) + a "Preview" toggle mounting `<iframe sandbox="allow-scripts allow-same-origin">`. -> `setWebContent`.
  - `<CanvasSettingsDialog>` (`"use client"`): `name`, `width`/`height` (a warning line when the new size clips an existing panel), background color (`<input type="color">` + hex), background image (media picker, IMAGE, clearable). -> `updateCanvas`.
  - `canvas-editor.tsx`: mount `<PanelInspector>` (right rail, when a panel is selected), `<FrameStrip>` (bottom, for the selected panel) and `<FrameContentEditor>` (opens for the selected frame), and a "Canvas settings" button opening `<CanvasSettingsDialog>`.

- [ ] **Step 1: `frame-strip.test.tsx` (write, run, fail)** -- render 3 frames; dragging the last chip to first calls `reorderFrames` with the new id order; the "Add frame" menu with "Web" calls `createFrame({ panelId, type: "WEB", durationSeconds: <default> })`; a duration input change calls `setFrameDuration`. FAIL.

- [ ] **Step 2: `frame-content-editor.test.tsx` (write, run, fail)** -- render with `frame.type === "WEB"`: typing `"notaurl"` shows the inline error and does NOT call `setWebContent`; a valid `https://x.test` calls it. Render with `frame.type === "CLOCK"`: toggling `showSeconds` calls `setClockContent` with `showSeconds: false`. Render with `frame.type === "PICTURE"`: picking an image asset calls `setImageContent` with that `mediaAssetId`. FAIL.

- [ ] **Step 3: implement the four components + mount them in `canvas-editor.tsx`**.

- [ ] **Step 4: run the canvas component suite + typecheck + lint** -- `npx vitest run src/components/app/canvas/` -- PASS / clean.

- [ ] **Step 5: Commit** -- `git commit -am "feat: canvas panel inspector, frame strip, content editors, settings"`

---

## Task 14: Canvas preview -- route, dialog, list thumbnail

**Files:**
- Create: `src/app/api/canvas/[id]/preview/route.ts`, `src/app/api/canvas/[id]/preview/preview.test.ts`, `src/components/app/canvas/canvas-preview-dialog.tsx`
- Modify: `src/components/app/canvas/canvas-editor.tsx` (Play button), `src/components/app/canvas/canvas-list.tsx` (optional media thumbnail via the route)

**Interfaces:**
- Consumes: `assembleCanvasManifest` (Task 5), `<CanvasStage>` (Task 12), `storage.createDownloadUrl`.
- Produces:
  - `GET /api/canvas/[id]/preview` -- `requireRole("canvas.view")`; loads the tree via `ctx.db` (same `include` as the editor page); collects `mediaAssetId`s + the background id; loads those `MediaAsset`s via `ctx.db`; presigns each `storageKey` once with `storage.createDownloadUrl(key, 3600)`; returns `assembleCanvasManifest(tree, k => urlMap.get(k) ?? "")`. Thin, mirrors `GET /api/playlists/[id]/preview`. A missing canvas -> `NotFoundError` -> 404.
  - `<CanvasPreviewDialog>` (`"use client"`): props `{ open; onOpenChange; canvasId }`. On open, fetch `/api/canvas/${canvasId}/preview`; render `<CanvasStage mode="play">` with each panel cycling its `frames` on their `durationSeconds` (a `setInterval` per panel keyed off the manifest); Image/Video via `<img>` / `<video>` from the presigned URL, Web in a sandboxed iframe, Clock ticking via `date-fns` + a 1s timer. Pause / resume / restart controls.
  - `canvas-editor.tsx`: a "Play" button opens `<CanvasPreviewDialog canvasId={canvas.id} />`.

- [ ] **Step 1: `preview.test.ts` (write, run, fail)** -- session-authed; seed a canvas with one image panel; `GET` returns the `CanvasManifest` with the panel and a presigned `image.url`; a canvas id from another org -> 404 / not-found; no session -> 401. Run: `npx vitest run src/app/api/canvas/[id]/preview/preview.test.ts` -- FAIL.

- [ ] **Step 2: implement the route**.

- [ ] **Step 3: implement `<CanvasPreviewDialog>` + wire the Play button** (no dedicated dialog unit test beyond typecheck; it is exercised by the e2e). Optionally swap the list wireframe for a real first-frame thumbnail using the route.

- [ ] **Step 4: run the preview test + full player/canvas suites + typecheck + lint** -- `npx vitest run src/app/api/canvas/ src/lib/player/ src/components/app/canvas/` -- PASS / clean.

- [ ] **Step 5: Commit** -- `git commit -am "feat: canvas preview route and play dialog"`

---

## Task 15: Wire `GET /api/player/sync`

**Files:**
- Modify: `src/app/api/player/sync/route.ts`
- Test: `src/app/api/player/sync/sync.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveScreenContent` canvas input (Task 6), `assembleCanvasManifest` (Task 5).
- Produces: the sync response gains `canvas: CanvasManifest | null`; `source` can be `"canvas"`.

- [ ] **Step 1: extend `sync.test.ts` (write, run, fail)**:
  - a screen with `canvasId` set, no campaign / schedule -> `source: "canvas"`, `canvas` object with the panels, `playlist` null.
  - a campaign covering that screen -> `source: "campaign"`, `canvas: null`.
  - a screen whose `canvasId` points at a since-deleted canvas -> falls through to the base playlist, 200, no throw.
  - the `source: "none"` early return carries `canvas: null`.
  Run: `npx vitest run src/app/api/player/sync/sync.test.ts` -- FAIL.

- [ ] **Step 2: implement**:
  - extend the screen `select` with `canvasId`.
  - `const canvasInput = screen.canvasId ? { canvasId: screen.canvasId } : null;` -> pass `canvas: canvasInput` into `resolveScreenContent`.
  - after `resolved`, when `resolved.source === "canvas"`: load the canvas tree scoped `organizationId: screen.organizationId` with the nested `include` + `orderBy` from spec 3.2; if the row is missing or has zero panels, recompute `resolved` with `canvas: null` (fall through). Else collect asset ids, load `MediaAsset`s scoped, presign keys once, `assembleCanvasManifest`, and set `canvasPayload`.
  - `canvasPayload` is `null` for every other `source`.
  - add `canvas: canvasPayload` to the final `NextResponse.json`, and `canvas: null` to the two early-return payloads.

- [ ] **Step 3: run the sync + player suites + typecheck** -- `npx vitest run src/app/api/player/ src/lib/player/` -- PASS / clean.

- [ ] **Step 4: Commit** -- `git commit -am "feat: player sync serves a canvas manifest for canvas-mode screens"`

---

## Task 16: Cross-tenant isolation tests

**Files:**
- Modify: `src/test/isolation/tenant-isolation.spec.ts`

**Interfaces:**
- Consumes: every canvas / panel / frame / content action, `setScreenContentSource`, the existing two-org fixture + RLS-backstop pattern.

- [ ] **Step 1: add fixtures** -- org B: `bCanvasId`, `bPanelId`, `bFrameId`, `bWebContentId` (a `WEB` frame with a `Web` row).

- [ ] **Step 2: add cross-org cases (write, run, fail then pass)** -- acting as org A:
  - `updateCanvas` / `duplicateCanvas` / `archiveCanvas` / `restoreCanvas` / `deleteCanvas` on `bCanvasId` -> `{ error }` / not-found, org B's canvas unchanged (re-read `revision` / `name` / `archivedAt`).
  - `createPanel({ canvasId: bCanvasId, ... })` -> rejected, no panel created.
  - `updatePanels(bCanvasId, ...)`, `deletePanel(bPanelId)`, `createFrame({ panelId: bPanelId, ... })`, `reorderFrames({ panelId: bPanelId, ... })`, `deleteFrame(bFrameId)`, `setWebContent({ frameId: bFrameId, ... })` -> each rejected, B's rows unchanged.
  - `setScreenContentSource({ screenId: <org A screen>, source: "canvas", canvasId: bCanvasId })` -> `{ error }`, the A screen's `canvasId` still null.
  - RLS backstop: under `withOrgTransaction(orgAId, tx => tx.$queryRawUnsafe(...))`, `count(*)` for `bCanvasId` in `"Canvas"`, `bPanelId` in `"Panel"`, `bFrameId` in `"Frame"`, `bWebContentId` in `"Web"` each return `0`.
  Run: `npx vitest run src/test/isolation/tenant-isolation.spec.ts` -- FAIL then PASS.

- [ ] **Step 3: full isolation + facade suite** -- `npx vitest run src/test/isolation/ src/lib/db/` -- PASS.

- [ ] **Step 4: Commit** -- `git commit -am "test: tenant isolation for canvas, panel, frame, web content"`

---

## Task 17: e2e, docs, demo script

**Files:**
- Create: `src/test/e2e/canvas.spec.ts`, `scripts/simulate-canvas.ts`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: the running dev server + seeded demo org.

- [ ] **Step 1: `scripts/simulate-canvas.ts`** -- mirror `scripts/simulate-schedule.ts` (idempotent, `--force`, "Costa Signage Co"). Build **Lobby Board** 1920x1080 (full-bleed media panel: 3 storefront `IMAGE` assets, 8s each; a top-right `CLOCK` panel style 1; a bottom `MEMO` panel "Welcome to Costa Signage"; a small `WEB` panel at a public URL) and **Portrait Menu** 1080x1920 (two stacked media panels). Put "Storefront LED Wall" into canvas mode via `setScreenContentSource`. Deterministic panel / frame / content ids (`${canvasSlug}:panel:N` etc.) so re-runs are a no-op via `skipDuplicates` / upsert. Print a summary table (canvases, panels, frames, screens switched). Run `npx tsx scripts/simulate-canvas.ts` after `simulate-schedule.ts` -- confirm success.

- [ ] **Step 2: `src/test/e2e/canvas.spec.ts`** -- register a fresh org, `resetDb()` + `seedPlans()` in `beforeAll`, seed a screen + a location + one `READY` `IMAGE` asset via `@/lib/db/root`. Journey: sign in; `/canvas`; New canvas (1920x1080); in the editor add a panel and drag it (assert the rendered `left` is grid-aligned); add an Image frame and pick the seeded asset; go to `/screens`, open the content-source dialog for the screen, switch it to Canvas, pick the new canvas; then `GET /api/player/sync` with the screen's device token returns `source: "canvas"` with one panel and one image frame. Real selectors from the Task 11-14 components; a `data-testid` only if there is genuinely no stable selector, noted in the report.

- [ ] **Step 3: `docs/architecture.md`** -- add a "Canvas editor" subsection after "Analytics": the `Canvas` -> `Panel` -> `Frame` -> `Content` hierarchy is now authorable; `Canvas.revision` + `bumpCanvasRevision`; the `WEB` frame type and `Web` model (tenant tables -> 35); the resolution precedence `campaign > schedule > canvas > base playlist > none`; `assembleCanvasManifest` and the `canvas` key on `GET /api/player/sync`; `setScreenContentSource` and the mutually-exclusive `Screen.playlistId` / `Screen.canvasId`; the five Plan-1 frame types and that Weather / News are Plan 2. Update the roadmap: increment 5 Plan 1 shipped, Plan 2 (Weather + News live-data frames) is the immediate follow-up; move "Visual canvas editor" out of the open list.

- [ ] **Step 4: rebuild dev data if needed** -- if `npm run test` ran at any point, recreate the demo account and re-run every `simulate-*.ts` in order (`account`, `team`, `content`, `media`, `playlists`, `campaigns`, `schedule`, `analytics`, `canvas`, `refresh`).

- [ ] **Step 5: Commit** -- `git commit -am "test: end-to-end canvas journey; docs and demo script"`

---

## Task 18: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: full unit + integration suite** -- with `db:up` + `storage:up`: `npm run test`. Expect green, count = 558 + the new tests. Investigate any regression before proceeding.

- [ ] **Step 2: typecheck + lint + build** -- `npm run typecheck && npm run lint && npm run build`. Clean (ignore pre-existing `tsconfig.json` / `simulate-account.ts` noise from a concurrent session).

- [ ] **Step 3: e2e** -- `npm run test:e2e`. All specs green including `canvas.spec.ts`.

- [ ] **Step 4: manual smoke** -- `npm run dev`; sign in; `/canvas`; new canvas; add + drag a panel (snapping visible); add an image frame; Play preview cycles it; `/screens` -> set a screen to canvas mode; a device poll for that screen returns `source: "canvas"` with the manifest; put a campaign over that screen and confirm `source: "campaign"`, `canvas: null`.

- [ ] **Step 5: hand off** -- REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch`. Base branch `main`.

---

## Self-Review

**Spec coverage**

- Spec 2 "In scope" 1-12 -> Task 1 (schema/migration/RLS/lists), Task 5 (`bumpCanvasRevision`), Task 2 (RBAC + nav), Task 4 (validation), Task 3 (`geometry.ts`), Task 5 (`assembleCanvasManifest`), Task 6 (`resolveScreenContent` tier), Task 15 (sync), Tasks 7-9 (canvas/panel/frame/content actions), Task 10 (`setScreenContentSource`), Tasks 11-14 (list + editor + preview), Task 7 (`deleteCanvas` guard), Task 17 (demo + tests + docs).
- Spec 3.1 resolution order -> Task 6 + Task 15. Spec 3.2 sync branch -> Task 15. Spec 3.3 `assembleCanvasManifest` incl. the non-Plan-1-type drop rule -> Task 5. Spec 3.4 revision -> Task 5 + the "bump first" Global Constraint. Spec 3.5 no deps -> Global Constraints.
- Spec 4 data model (Canvas cols, `WEB` enum, `Web` model, no CHECK) -> Task 1. Spec 4.4 RLS `ARRAY['Web']` -> Task 1 Step 4.
- Spec 5 validation (every schema, the `setScreenContentSource` refine, the `https?` refine) -> Task 4.
- Spec 6 actions table (all of them) + the `deleteCanvas` guard message -> Tasks 7, 8, 9, 10.
- Spec 7 RBAC + sidebar icon -> Task 2. Spec 8 UI (8.1 list, 8.2 editor, 8.3 geometry, 8.4 screens cell, 8.5 preview route) -> Tasks 11, 12, 13, 10, 14. Spec 9 demo -> Task 17. Spec 10 testing (10.1-10.9) -> Tasks 3, 5, 6, 4, 7-10, 16, 13, 15, 17. Spec 11 deliverables -> covered file-by-file. Spec 12 risks -> Global Constraints (`ALTER TYPE` ordering, `updatePanels` amplification, bg-image cleanup, clock tz passthrough, web-frame iframe).

**Placeholder scan** -- `<ts>` is the Prisma-assigned migration timestamp, resolved in Task 1 Step 3. No `TBD`/`TODO`. Task 11 Step 1 and Task 12 Step 2 contain explicit DECISION lines that resolve to a single approach (wireframe list; `useCanvasDrag` hook if the file grows) - the executor takes the resolved approach.

**Type consistency** -- `Rect` / `Guide` from `geometry.ts` (Task 3) are consumed by `<CanvasStage>` / `<CanvasEditor>` (Task 12). `CanvasTree` / `CanvasManifest` from `canvas-manifest.ts` (Task 5) are consumed by the sync route (Task 15), the preview route (Task 14), and `<CanvasPreviewDialog>` (Task 14). `ScreenContent` gains `{ source: "canvas"; canvasId }` (Task 6) consumed by the sync route (Task 15). The `FrameType` enum values used in `frameSchema` (Task 4), `assembleCanvasManifest` drop rule (Task 5), the content actions' `Frame.type` writes (Task 9), and the frame strip type menu (Task 13) are the same five: `CLOCK` / `PICTURE` / `VIDEO` / `MEMO` / `WEB`. `setScreenContentSource`'s `{ screenId, source, playlistId?, canvasId? }` shape is identical in the schema (Task 4), the action (Task 10), and the dialog (Task 10). Action names are stable throughout: `createCanvas` / `updateCanvas` / `duplicateCanvas` / `archiveCanvas` / `restoreCanvas` / `deleteCanvas` / `createPanel` / `updatePanels` / `deletePanel` / `duplicatePanel` / `createFrame` / `reorderFrames` / `setFrameDuration` / `deleteFrame` / `setImageContent` / `setVideoContent` / `setTextContent` / `setClockContent` / `setWebContent` / `setScreenContentSource`.
