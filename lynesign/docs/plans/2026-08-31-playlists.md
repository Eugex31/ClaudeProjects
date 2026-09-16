# Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship LyneSign Playlists — org-scoped ordered sequences of media library assets, assigned one-per-screen, delivered to devices through a real `GET /api/player/sync` manifest.

**Architecture:** Two new tenant-scoped, RLS-forced tables (`Playlist`, `PlaylistItem`) under the existing `forOrg` facade. `Screen` gains a nullable `playlistId`. Items carry a 0-based integer `position` rewritten as a clean permutation on every mutation inside one transaction; `Playlist.revision` is a monotonic int bumped on every structural change for device-side cache detection. Player sync assembles the manifest on demand with a pure function and presigned GET URLs. No scheduling, no campaigns, no draft/publish, no device renderer.

**Tech Stack:** Next.js 16.2.11, React 19, Prisma 6.19.x + `@prisma/adapter-pg`, PostgreSQL, `zod@^4`, `@aws-sdk/s3-request-presigner` (already present), Vitest, Playwright.

**Spec:** `docs/specs/2026-08-31-playlists-design.md`

## Global Constraints

- Branch `playlists` off `main` (currently at the `docs: playlists design spec` commit). Runtime pins unchanged (`next@16.2.11`, `react@19.2.4`, `prisma`/`@prisma/client`/`@prisma/adapter-pg@^6.19.x`, `zod@^4`). TypeScript `strict`.
- Every tenant-data read/write goes through `forOrg` / `withOrgTransaction`. `Playlist` and `PlaylistItem` are added to **all three** lists — the `*_rls*` migration `ARRAY`, `TENANT_MODELS` (`src/lib/db/tenant.ts`), `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`) — taking each to 27 entries; `src/lib/db/tenant-model-list.test.ts` must stay green.
- Raw `prisma` (`@/lib/db/root`) is import-restricted by the ESLint `no-restricted-imports` allow-list. `src/app/api/player/sync/route.ts` is device-authed with no org context and legitimately needs the root client; add it to the allow-list with a one-line reason if it is not already covered.
- Every mutating server action: `requireRole(<action>)` as the first statement, then `safeParse` the input, then work inside `withOrgTransaction`, then `bumpRevision` where a playlist or item changed, then `writeAudit(...)`, then `revalidatePath`. `redirect()` (if any) stays outside try/catch. Every caller-supplied id is resolved through `ctx.db` so a cross-org id reads as absent.
- RLS policy predicate for the new tables is **byte-identical** to migration `20260830032500_rls_empty_guc_is_unscoped`: `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`, both USING and WITH CHECK, with `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- Copy rules: no em dashes, no emojis, no exclamation points in any user-facing string, error, toast, log line, audit action, or doc prose. Terse; end error strings with a period.
- No new npm dependencies. Reorder UI is up/down buttons (the tested path) plus an optional native HTML5 drag handle.
- RSC boundary: `page.tsx` server components pass only serializable props into `"use client"` children; no function/render-closure props cross the boundary (Foundation lesson).
- TDD: write the failing test, run it and watch it fail, implement the minimum, run it and watch it pass, commit. Conventional Commits.
- Commands run from `lynesign/`. `npm run db:up` and `npm run storage:up` must both be running for integration/e2e suites. Pure unit tests take no DB or storage.
- Known baseline: `npm run test` is 217 passing across 45 files on `main` with services up.

---

## File Structure

```
lynesign/
  prisma/
    schema.prisma                                  # + Playlist, PlaylistItem, Screen.playlistId, back-relations
    migrations/<ts>_playlists/migration.sql         # tables + column + FKs + RLS DO block
  src/
    lib/
      db/tenant.ts                                  # TENANT_MODELS += playlist, playlistItem
      rbac/policy.ts                                # Action union + POLICY += playlist.*
      nav.ts                                        # /playlists item gets action: "playlist.view"
      validation/playlists.ts                       # NEW - zod schemas
      player/manifest.ts                            # NEW - assembleManifest pure fn
      playlists/revision.ts                         # NEW - bumpRevision(tx, playlistId) helper
    test/isolation/tenant-tables.ts                 # TENANT_TABLES += Playlist, PlaylistItem
    app/
      (app)/playlists/
        actions.ts                                  # NEW - all server actions
        page.tsx                                    # replace ComingSoon - list
        [id]/page.tsx                               # NEW - editor server component
      (app)/screens/                                # screen form gains a Playlist select + wiring
      api/player/sync/route.ts                      # replace stub with real manifest
    components/app/playlists/                        # NEW
      playlist-list.tsx
      new-playlist-dialog.tsx
      playlist-editor.tsx
      playlist-item-row.tsx
      add-media-dialog.tsx
      assigned-screens-panel.tsx
      playlist-settings-dialog.tsx
    worker/jobs/purgeArchivedMedia.ts               # + PlaylistItem reference guard
    lib/db/root.ts                                  # doc comment kept in sync if allow-list changes
  eslint.config.mjs                                 # allow @/lib/db/root in api/player/sync if needed
  docs/architecture.md                             # + Playlists section, roadmap update
  scripts/simulate-playlists.ts                     # NEW - demo data (excluded from typecheck)
  src/test/
    lib/player/manifest.test.ts                     # NEW
    lib/validation/playlists.test.ts                # NEW
    app/(app)/playlists/playlists.test.ts           # NEW - action integration
    app/api/player/sync/sync.test.ts                # NEW or extend player.test.ts
    isolation/tenant-isolation.spec.ts              # + playlist cases
    worker/jobs/media.test.ts                       # + purge-guard case
    components/app/playlists/*.test.tsx             # NEW - component tests
    e2e/playlists.spec.ts                           # NEW
```

---

## Task 1: Schema, migration, RLS, list sync, validation module

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_playlists/migration.sql`
- Modify: `src/lib/db/tenant.ts` (`TENANT_MODELS`)
- Modify: `src/test/isolation/tenant-tables.ts` (`TENANT_TABLES`)
- Create: `src/lib/validation/playlists.ts`
- Test: `prisma/playlists-schema.test.ts`, `src/lib/validation/playlists.test.ts`
- Existing test that must stay green: `src/lib/db/tenant-model-list.test.ts`

**Interfaces:**
- Produces:
  - `Playlist` model: `id`, `organizationId`, `name`, `description String?`, `defaultImageDurationSeconds Int @default(10)`, `defaultWebDurationSeconds Int @default(30)`, `revision Int @default(1)`, `createdByUserId String?`, `createdAt`, `updatedAt`, `archivedAt DateTime?`. Relations: `organization` (`onDelete: Cascade`), `createdBy User? @relation("PlaylistCreator", onDelete: SetNull)`, `items PlaylistItem[]`, `screens Screen[]`. `@@index([organizationId])`, `@@index([organizationId, archivedAt])`.
  - `PlaylistItem` model: `id`, `organizationId`, `playlistId`, `mediaAssetId`, `position Int`, `durationSeconds Int?`, `enabled Boolean @default(true)`, `createdAt`, `updatedAt`. Relations: `organization` (`Cascade`), `playlist Playlist @relation(onDelete: Cascade)`, `mediaAsset MediaAsset @relation(onDelete: Restrict)`. `@@index([playlistId, position])`, `@@index([organizationId])`, `@@index([mediaAssetId])`. No `@@unique` on `[playlistId, position]` or `[playlistId, mediaAssetId]`.
  - `Screen.playlistId String?` + `playlist Playlist? @relation(fields: [playlistId], references: [id], onDelete: SetNull)` + `@@index([playlistId])`.
  - Back-relations: `MediaAsset.playlistItems PlaylistItem[]`, `Organization.playlists Playlist[]`, `Organization.playlistItems PlaylistItem[]`, `User.createdPlaylists Playlist[] @relation("PlaylistCreator")`.
  - `src/lib/validation/playlists.ts` exports: `createPlaylistSchema`, `updatePlaylistSchema`, `addItemsSchema`, `setItemDurationSchema`, `reorderItemsSchema`, `idSchema`.

- [ ] **Step 1: schema test (write, run, fail)**

`prisma/playlists-schema.test.ts` — parse `prisma/schema.prisma` as text and assert:
```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const schema = readFileSync("prisma/schema.prisma", "utf8");
it("Playlist and PlaylistItem exist and are tenant-scoped", () => {
  expect(schema).toMatch(/model Playlist \{/);
  expect(schema).toMatch(/model PlaylistItem \{/);
  expect(schema).toMatch(/revision\s+Int\s+@default\(1\)/);
});
it("PlaylistItem.mediaAsset is onDelete Restrict", () => {
  const block = schema.match(/model PlaylistItem \{[\s\S]*?\n\}/)![0];
  expect(block).toMatch(/mediaAsset\s+MediaAsset\s+@relation\([^)]*onDelete:\s*Restrict/);
});
it("Screen has a nullable playlistId with SetNull", () => {
  const block = schema.match(/model Screen \{[\s\S]*?\n\}/)![0];
  expect(block).toMatch(/playlistId\s+String\?/);
  expect(block).toMatch(/onDelete:\s*SetNull/);
});
```
Run: `npm run test -- prisma/playlists-schema.test.ts` — FAIL.

- [ ] **Step 2: edit `prisma/schema.prisma`**

Add the two models and the `Screen` column exactly per the Interfaces block above, plus the four back-relations. Then `npx prisma generate` (exit 0) and re-run the schema test — PASS.

- [ ] **Step 3: create the migration**

`npx prisma migrate dev --name playlists --create-only` to scaffold, then hand-append an RLS block to the generated `migration.sql`:
```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Playlist','PlaylistItem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true))
      WITH CHECK (coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true))
    $f$, t);
  END LOOP;
END $$;
```
(Match the exact style of the block in `20260830183100_media_library/migration.sql`.)

- [ ] **Step 4: apply and verify RLS**

`npx prisma migrate deploy` — applies clean on top of the 7 existing. Then a one-off `psql` / node check: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('Playlist','PlaylistItem')` → both `t/t`; `SELECT polname FROM pg_policy JOIN pg_class ON pg_class.oid = polrelid WHERE relname IN ('Playlist','PlaylistItem')` → `tenant_isolation` for each. Also confirm the migration applies from an empty DB (throwaway database, since `prisma migrate reset` is blocked for agents).

- [ ] **Step 5: list sync**

`src/lib/db/tenant.ts`: `TENANT_MODELS` += `"playlist"`, `"playlistItem"` (now 27).
`src/test/isolation/tenant-tables.ts`: `TENANT_TABLES` += `"Playlist"`, `"PlaylistItem"` (now 27).
Run `npm run test -- src/lib/db/tenant-model-list.test.ts` — PASS (all three lists agree at 27).

- [ ] **Step 6: validation module (test first)**

`src/lib/validation/playlists.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createPlaylistSchema, updatePlaylistSchema, addItemsSchema, setItemDurationSchema, reorderItemsSchema } from "@/lib/validation/playlists";

it("createPlaylistSchema", () => {
  expect(createPlaylistSchema.safeParse({ name: "Lobby" }).success).toBe(true);
  expect(createPlaylistSchema.safeParse({ name: "  " }).success).toBe(false);
  expect(createPlaylistSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
});
it("updatePlaylistSchema rejects out-of-range durations", () => {
  expect(updatePlaylistSchema.safeParse({ defaultImageDurationSeconds: 0 }).success).toBe(false);
  expect(updatePlaylistSchema.safeParse({ defaultImageDurationSeconds: 3601 }).success).toBe(false);
  expect(updatePlaylistSchema.safeParse({ defaultImageDurationSeconds: 15 }).success).toBe(true);
});
it("addItemsSchema bounds the batch", () => {
  expect(addItemsSchema.safeParse({ mediaAssetIds: [] }).success).toBe(false);
  expect(addItemsSchema.safeParse({ mediaAssetIds: Array(101).fill("a") }).success).toBe(false);
  expect(addItemsSchema.safeParse({ mediaAssetIds: ["a", "b"] }).success).toBe(true);
});
it("setItemDurationSchema allows null or 1..3600", () => {
  expect(setItemDurationSchema.safeParse({ durationSeconds: null }).success).toBe(true);
  expect(setItemDurationSchema.safeParse({ durationSeconds: 0 }).success).toBe(false);
});
it("reorderItemsSchema needs at least one id", () => {
  expect(reorderItemsSchema.safeParse({ itemIds: [] }).success).toBe(false);
});
```
Run — FAIL.

- [ ] **Step 7: implement `src/lib/validation/playlists.ts`**

```ts
import { z } from "zod";

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500);
const duration = z.number().int().min(1).max(3600);
export const idSchema = z.string().min(1);

export const createPlaylistSchema = z.object({
  name,
  description: description.optional(),
});
export const updatePlaylistSchema = z.object({
  name: name.optional(),
  description: description.nullable().optional(),
  defaultImageDurationSeconds: duration.optional(),
  defaultWebDurationSeconds: duration.optional(),
});
export const addItemsSchema = z.object({
  mediaAssetIds: z.array(z.string().min(1)).min(1).max(100),
});
export const setItemDurationSchema = z.object({
  durationSeconds: duration.nullable(),
});
export const reorderItemsSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
});
```
Run — PASS. Full `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 8: commit** — `git add -A && git commit -m "feat: playlist schema, RLS, and validation module"`

---

## Task 2: RBAC actions and nav gate

**Files:**
- Modify: `src/lib/rbac/policy.ts`
- Modify: `src/lib/nav.ts`
- Test: `src/lib/rbac/can.test.ts`, `src/lib/nav.test.ts` (extend)

**Interfaces:**
- Consumes: `ALL`, `CONTENT_UP`, `MANAGERS_UP` from `policy.ts`.
- Produces: `Action` union += `"playlist.view" | "playlist.create" | "playlist.update" | "playlist.delete" | "playlist.assign"`. `POLICY` rows: `playlist.view` → `ALL`; `playlist.create` → `CONTENT_UP`; `playlist.update` → `CONTENT_UP`; `playlist.delete` → `MANAGERS_UP`; `playlist.assign` → `MANAGERS_UP`. `src/lib/nav.ts` `/playlists` item gains `action: "playlist.view"`.

- [ ] **Step 1: extend `can.test.ts`** — add cases:
```ts
it("playlist permissions by role", () => {
  const contentMgr = actor("CONTENT_MANAGER");
  const manager = actor("MANAGER");
  const viewer = actor("VIEWER");
  expect(can(viewer, "playlist.view")).toBe(true);
  expect(can(contentMgr, "playlist.create")).toBe(true);
  expect(can(contentMgr, "playlist.delete")).toBe(false);
  expect(can(contentMgr, "playlist.assign")).toBe(false);
  expect(can(manager, "playlist.delete")).toBe(true);
  expect(can(manager, "playlist.assign")).toBe(true);
});
```
(Use whatever `actor(role)` helper the file already has.) Run — FAIL.

- [ ] **Step 2:** add the five strings to the `Action` union and the five rows to `POLICY` in `src/lib/rbac/policy.ts`. Run `can.test.ts` — PASS.

- [ ] **Step 3: nav** — add `action: "playlist.view"` to the `/playlists` entry in `src/lib/nav.ts`. Extend `src/lib/nav.test.ts` if it enumerates per-item actions. Run — PASS.

- [ ] **Step 4:** full `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 5: commit** — `git add -A && git commit -m "feat: playlist RBAC actions and nav gate"`

---

## Task 3: Manifest assembly pure function

**Files:**
- Create: `src/lib/player/manifest.ts`
- Test: `src/lib/player/manifest.test.ts`

**Interfaces:**
- Produces: `assembleManifest(args)` and `ManifestItem` exactly as in spec §7. `assembleManifest` takes `{ playlist: { defaultImageDurationSeconds, defaultWebDurationSeconds }, items: PlaylistItemLike[], assetsById: Map<string, AssetLike>, signUrl: (storageKey: string) => string }` and returns `ManifestItem[]`. It performs no I/O, never throws, and skips any item it cannot render.

- [ ] **Step 1: test (write, run, fail)** — `src/lib/player/manifest.test.ts`, cases:
  - two enabled items sorted by `position` (input given out of order) come back in position order.
  - a `enabled: false` item is dropped.
  - an item whose asset is `archivedAt != null` is dropped; `status: "FAILED"` dropped; asset absent from the map dropped.
  - `WEB` item with `asset.url = null` is dropped; `IMAGE` item with `storageKey = null` is dropped.
  - `signUrl` is called once per surviving IMAGE/VIDEO, never for WEB (spy).
  - duration: item override wins; else IMAGE/WEB use the matching playlist default; else VIDEO uses `asset.durationSeconds`; VIDEO with `durationSeconds: null` yields `0`.
  - `mimeType` / `width` / `height` copied from the asset; `null` for WEB.

- [ ] **Step 2: implement `src/lib/player/manifest.ts`** to make it pass. Keep it a single exported function plus the `ManifestItem` interface.

- [ ] **Step 3:** run the test — PASS. `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** — `git add -A && git commit -m "feat: player manifest assembly"`

---

## Task 4: Playlist CRUD actions

**Files:**
- Create: `src/lib/playlists/revision.ts`
- Create: `src/app/(app)/playlists/actions.ts` (partial — CRUD only; Task 5 appends item actions; Task 6 appends the screen-assignment action)
- Test: `src/app/(app)/playlists/playlists.test.ts` (create)

**Interfaces:**
- Consumes: `requireRole` (`@/lib/auth/context`), `withOrgTransaction` (`@/lib/db/tenant`), `writeAudit` (`@/lib/audit`), `revalidatePath` (`next/cache`), the Task 1 zod schemas, `NotFoundError` (`@/lib/errors`).
- Produces:
  - `bumpRevision(tx, playlistId: string): Promise<void>` in `src/lib/playlists/revision.ts` — `tx.playlist.update({ where: { id: playlistId }, data: { revision: { increment: 1 } } })`. `tx` is the tenant transaction client.
  - `createPlaylist(input: { name: string; description?: string }): Promise<{ id: string } | { error: string }>` — `requireRole("playlist.create")`; `safeParse` `createPlaylistSchema`; create with `organizationId: ctx.organizationId`, `createdByUserId: ctx.user.id`; audit `playlist.create` (targetType `Playlist`, targetId new id); `revalidatePath("/playlists")`; return `{ id }`.
  - `updatePlaylist(id: string, patch: { name?: string; description?: string | null; defaultImageDurationSeconds?: number; defaultWebDurationSeconds?: number }): Promise<{ error?: string }>` — `requireRole("playlist.update")`; `idSchema` + `updatePlaylistSchema`; the playlist must resolve via `ctx.db.playlist.findUnique` else `NotFoundError`; update inside `withOrgTransaction`, then `bumpRevision` (default-duration changes affect the manifest); audit `playlist.update`; `revalidatePath("/playlists")` and `revalidatePath(\`/playlists/${id}\`)`.
  - `archivePlaylist(id)` — `requireRole("playlist.delete")`; set `archivedAt = new Date()`; no revision bump needed (assembly still works) but bump anyway for consistency is acceptable — **do not** bump (archiving is not a manifest change; screens keep playing until reassigned). Audit `playlist.archive`.
  - `restorePlaylist(id)` — `requireRole("playlist.update")`; clear `archivedAt`; audit `playlist.restore`.
  - `deletePlaylist(id)` — `requireRole("playlist.delete")`; `ctx.db.playlist.delete` (cascades items; `Screen.playlistId` nulled by SetNull); audit `playlist.delete`; `revalidatePath("/playlists")`.

- [ ] **Step 1: tests (write, run, fail)** — `src/app/(app)/playlists/playlists.test.ts`, real DB, mock `next/cache` `revalidatePath`, mock `@/lib/auth/context` `requireRole`/`requireOrg` to a bound org-A context (follow the pattern in `src/app/(app)/media/media.test.ts` / `tenant-isolation.spec.ts`). Cases:
  - `createPlaylist({ name: "Lobby" })` → `{ id }`, a row exists with `revision: 1`, `createdByUserId` set, an audit row `playlist.create`.
  - `createPlaylist({ name: " " })` → `{ error }`, no row.
  - `updatePlaylist(id, { defaultImageDurationSeconds: 20 })` → row updated, `revision` is 2.
  - `updatePlaylist("nonexistent", {...})` → throws `NotFoundError` (or `{ error }` — match the file's convention; spec says `NotFoundError`).
  - `archivePlaylist(id)` → `archivedAt` set, `revision` unchanged.
  - `restorePlaylist(id)` → `archivedAt` null.
  - `deletePlaylist(id)` → row gone.

- [ ] **Step 2: implement** `src/lib/playlists/revision.ts` then the CRUD half of `src/app/(app)/playlists/actions.ts` (`"use server"` at top). Run the tests — PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** — `git add -A && git commit -m "feat: playlist create, update, archive, and delete actions"`

---

## Task 5: Playlist item actions

**Files:**
- Modify: `src/app/(app)/playlists/actions.ts` (append)
- Modify: `src/app/(app)/playlists/playlists.test.ts` (append)

**Interfaces:**
- Produces (all `"use server"`, all `requireRole("playlist.update")` first, all end with `bumpRevision` + `writeAudit` + `revalidatePath(\`/playlists/${playlistId}\`)`):
  - `addItems(playlistId: string, input: { mediaAssetIds: string[] }): Promise<{ added: number } | { error: string }>` — `addItemsSchema`; playlist must resolve via `ctx.db`; for each `mediaAssetId` in order: it must resolve via `ctx.db.mediaAsset.findUnique` and have `archivedAt == null` and `status == "READY"` (else `{ error: "One of those assets is not available." }` and no rows written). Inside `withOrgTransaction`: read `count` of existing items, create the new items at `position = count, count+1, ...` in the given order with `organizationId: ctx.organizationId`. Audit `playlist.items.add` with `{ count: added }`.
  - `removeItem(itemId: string): Promise<{ error?: string }>` — `idSchema`; item resolves via `ctx.db.playlistItem.findUnique` (capture its `playlistId` and `position`); inside a tx: delete it, then `updateMany` / individual updates to set `position = position - 1` for every sibling with `position > removed.position` (compact to `0..n-2`). `bumpRevision(tx, playlistId)`. Audit `playlist.items.remove`.
  - `reorderItems(playlistId: string, input: { itemIds: string[] }): Promise<{ error?: string }>` — `reorderItemsSchema`; playlist resolves via `ctx.db`; load its item ids; if `new Set(input.itemIds)` is not exactly equal to the set of the playlist's item ids → `{ error: "That reorder does not match the playlist." }`. Inside a tx: for each `itemIds[i]`, `update` its `position` to `i`. `bumpRevision`. Audit `playlist.items.reorder`.
  - `setItemDuration(itemId: string, input: { durationSeconds: number | null }): Promise<{ error?: string }>` — `setItemDurationSchema`; item resolves via `ctx.db`; update `durationSeconds`; `bumpRevision(tx, item.playlistId)`. Audit `playlist.items.duration`.
  - `setItemEnabled(itemId: string, enabled: boolean): Promise<{ error?: string }>` — `z.boolean()` guard; item resolves via `ctx.db`; update `enabled`; `bumpRevision`. Audit `playlist.items.enabled`.

- [ ] **Step 1: tests (append, run, fail)** — cases:
  - `addItems(pl, { mediaAssetIds: [a, b, c] })` → `{ added: 3 }`, positions `0,1,2` in that order, `revision` bumped by 1 (one action, not three).
  - a second `addItems(pl, { mediaAssetIds: [d] })` → new item at position `3`.
  - `addItems(pl, { mediaAssetIds: [archivedAssetId] })` → `{ error }`, no new rows, `revision` unchanged.
  - `reorderItems(pl, { itemIds: [id2, id0, id1] })` → positions become `id2:0, id0:1, id1:2`; `revision` bumped.
  - `reorderItems(pl, { itemIds: [id0, id1] })` (missing one) → `{ error }`, positions unchanged.
  - `removeItem(middleId)` → row gone, remaining positions compact to `0,1`; `revision` bumped.
  - `setItemDuration(id, { durationSeconds: 25 })` then `{ durationSeconds: null }` → value set then cleared; `revision` bumped each time.
  - `setItemEnabled(id, false)` → `enabled` false; `revision` bumped.
  - After all operations, `SELECT position FROM "PlaylistItem" WHERE "playlistId" = pl ORDER BY position` is exactly `0..n-1` with no gaps or dups.

- [ ] **Step 2: implement** the five actions. Run tests — PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** — `git add -A && git commit -m "feat: playlist item add, remove, reorder, duration, and enable actions"`

---

## Task 6: Screen assignment action and screen-form wiring

**Files:**
- Modify: `src/app/(app)/playlists/actions.ts` (append `assignPlaylistToScreen`)
- Modify: `src/app/(app)/playlists/playlists.test.ts` (append)
- Modify: `src/app/(app)/screens/` — the screen create/edit form + its actions (identify the exact files: `screen-form.tsx`, `actions.ts`)
- Test: extend the screens action test if one exists, else add coverage in `playlists.test.ts`

**Interfaces:**
- Produces:
  - `assignPlaylistToScreen(screenId: string, playlistId: string | null): Promise<{ error?: string }>` — `requireRole("playlist.assign")`; `idSchema` on `screenId`; `playlistId` is `idSchema.nullable()`. The screen must resolve via `ctx.db.screen.findUnique`; if `playlistId` is non-null it must resolve via `ctx.db.playlist.findUnique` and be `archivedAt == null`. `ctx.db.screen.update({ where: { id: screenId }, data: { playlistId } })`. **No `bumpRevision`** (screen membership is not part of the manifest). Audit `screen.playlist.assign` with metadata `{ screenId, playlistId }`. `revalidatePath("/screens")`, `revalidatePath("/playlists")`, and `revalidatePath(\`/playlists/${playlistId}\`)` when non-null.
- Consumes (screen form): the org's non-archived playlists list for the `<select>` options.

- [ ] **Step 1: tests (append, run, fail)** — cases in `playlists.test.ts`:
  - `assignPlaylistToScreen(screenId, playlistId)` → `screen.playlistId` set; playlist `revision` unchanged; audit row `screen.playlist.assign`.
  - `assignPlaylistToScreen(screenId, null)` → `screen.playlistId` null.
  - `assignPlaylistToScreen(screenId, archivedPlaylistId)` → `{ error }`, unchanged.

- [ ] **Step 2: implement** `assignPlaylistToScreen`.

- [ ] **Step 3: screen form** — read `src/app/(app)/screens/screen-form.tsx` and `src/app/(app)/screens/actions.ts`. Add a "Playlist" `<select>` (options: `{ id, name }` of the org's non-archived playlists, plus a "None" option mapping to empty). On create: after `createScreen` returns the new screen id, if a playlist was chosen call `assignPlaylistToScreen(newId, playlistId)`. On edit: call `assignPlaylistToScreen(screenId, playlistId | null)` directly. Keep `createScreen`'s own validation untouched other than optionally threading a `playlistId` string through; the assignment itself always goes through the gated action. The screens list/detail page passes the playlists list into the form (server component reads `ctx.db.playlist.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })`).

- [ ] **Step 4:** manual check with `npm run dev` — create a screen with a playlist, edit it to "None", confirm `screen.playlistId` in the DB. Full `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 5: commit** — `git add -A && git commit -m "feat: assign a playlist to a screen"`

---

## Task 7: Wire GET /api/player/sync

**Files:**
- Modify: `src/app/api/player/sync/route.ts`
- Modify: `eslint.config.mjs` (allow `@/lib/db/root` for the sync route if not already covered)
- Test: `src/app/api/player/sync/sync.test.ts` (new) or extend `src/app/api/player/player.test.ts`

**Interfaces:**
- Consumes: `authenticateDevice` (`@/lib/player/device-auth`), `assembleManifest` (Task 3), `storage.createDownloadUrl` (`@/lib/storage`), `withRequestId` + `toProblem` (existing in the route).
- Produces: the real response shape from spec §6:
  ```
  { screenId, pollIntervalSeconds, playlist: null }
  // or
  { screenId, pollIntervalSeconds, playlist: { id, name, revision, items: ManifestItem[] } }
  ```
  The `canvas` key is removed from the response.

- [ ] **Step 1: tests (write, run, fail)** — real DB + MinIO (`npm run storage:up`). Build an org, a screen, pair it (call the `pair` route or insert `deviceTokenHash` directly using the same hashing `newDeviceToken` uses), a playlist with: 1 READY image (put a real object + set `storageKey`), 1 READY video (`storageKey` + `durationSeconds: 30`), 1 WEB asset (`url` set), 1 disabled item, 1 item whose asset is archived. Assign the playlist to the screen. Then:
  - `GET /api/player/sync` with the device bearer token → `playlist.items` has exactly the 3 live items in `position` order; the image and video `url` start with the local storage endpoint and contain a signature query; the web `url` equals the asset `url`; `playlist.revision` equals the row.
  - a screen with `playlistId: null` → `{ playlist: null }`.
  - missing / bad bearer token → 401 problem (unchanged behavior).

- [ ] **Step 2: implement** — replace the stub body. Load the screen via the root `prisma` client with `where: { id: screen.id }` selecting `organizationId, pollIntervalSeconds, playlistId` (the `authenticateDevice` result may already carry enough; if so, skip the extra query). If `playlistId` null → return the null-playlist shape. Else load the playlist (`id, name, revision, defaultImageDurationSeconds, defaultWebDurationSeconds`) and its `enabled` items `orderBy: { position: "asc" }`, then `mediaAsset.findMany({ where: { id: { in: assetIds } } })` selecting the fields `assembleManifest` needs. Call `assembleManifest({ playlist, items, assetsById, signUrl: (k) => /* await? */ })`. Note `createDownloadUrl` is async; either pre-sign all keys before calling `assembleManifest` (build a `Map<storageKey, signedUrl>` and pass `signUrl: (k) => map.get(k)!`) or make a small local sync wrapper. Pre-signing up front is cleaner. Keep everything inside the route's `try` / `toProblem`.

- [ ] **Step 3: eslint** — if `src/app/api/player/sync/route.ts` is not already in the `RAW_PRISMA_ALLOWED` list in `eslint.config.mjs`, add it with the reason `device-authed route, no session org context (same as pair/heartbeat)`. Keep `src/lib/db/root.ts`'s doc comment in sync. Run `npm run lint` — clean.

- [ ] **Step 4:** run the sync tests — PASS. Full `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` green.

- [ ] **Step 5: commit** — `git add -A && git commit -m "feat: player sync returns the real playlist manifest"`

---

## Task 8: purgeArchivedMedia PlaylistItem guard

**Files:**
- Modify: `src/worker/jobs/purgeArchivedMedia.ts`
- Modify: `src/worker/jobs/media.test.ts` (append)

**Interfaces:**
- Consumes: `prisma` (root, already allow-listed for `src/worker/jobs/**`).
- Produces: the purge guard also counts `PlaylistItem` references.

- [ ] **Step 1: test (append, run, fail)** — seed an archived (older than the purge cutoff) `MediaAsset` referenced by one `PlaylistItem` (create a minimal `Playlist` + `PlaylistItem`). Run `purgeArchivedMedia()` → the asset row is still present, its object not deleted, `{ purged: 0 }` for that asset. Keep the existing "archived and unreferenced is purged" case green.

- [ ] **Step 2: implement** — in the reference check, add `+ (await prisma.playlistItem.count({ where: { mediaAssetId: id } }))` so the asset is skipped when any playlist still uses it.

- [ ] **Step 3:** run the worker tests — PASS. `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** — `git add -A && git commit -m "fix: do not purge a media asset still used by a playlist"`

---

## Task 9: /playlists list page

**Files:**
- Modify: `src/app/(app)/playlists/page.tsx` (replace `ComingSoon`)
- Create: `src/components/app/playlists/playlist-list.tsx`, `src/components/app/playlists/new-playlist-dialog.tsx`
- Test: `src/components/app/playlists/playlist-list.test.tsx`

**Interfaces:**
- Consumes: `requireRole("playlist.view")`, `ctx.db`, `can`, `createPlaylist` (Task 4), existing `PageHeader` / `EmptyState` / `Dialog` / `Button` / `Input` primitives, `sonner` `toast`, `useRouter`.
- Produces:
  - `page.tsx` (server): `requireRole("playlist.view")`; one `withOrgTransaction` — `playlist.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { items: true } } } })` and `screen.groupBy({ by: ["playlistId"], where: { playlistId: { not: null } }, _count: true })`. Render `<PageHeader title="Playlists" actions={canCreate ? <NewPlaylistDialog/> : null}>` + `<PlaylistList rows={rows} canCreate={canCreate} />` where each row is `{ id, name, itemCount, screenCount, updatedLabel }` (all serializable; format the date to a label server-side). `<EmptyState icon=... title="No playlists yet" description="Create a playlist to sequence media for your screens." action={canCreate ? <NewPlaylistDialog/> : null} />` when empty.
  - `NewPlaylistDialog` (`"use client"`): a `Dialog` with a name + optional description field; on submit calls `createPlaylist`, on `{ id }` `router.push(\`/playlists/${id}\`)`, on `{ error }` `toast.error(error)`.
  - `PlaylistList` (`"use client"` or server — server is fine, it has no interactivity): a table/list of rows linking to `/playlists/[id]`, columns name / items / "on N screens" / updated.

- [ ] **Step 1: `playlist-list.test.tsx` (jsdom, write, run, fail)** — render `PlaylistList` with two rows; assert both names render, the item counts render, "on 2 screens" renders for a row with `screenCount: 2`, and "on 0 screens" (or a dash) for `screenCount: 0`. Mock `next/navigation` and the actions module per the repo pattern.

- [ ] **Step 2: implement** `PlaylistList`, `NewPlaylistDialog`, and `page.tsx`. Run the component test — PASS.

- [ ] **Step 3:** `npm run dev`, visit `/playlists` — empty state, create one, land on the editor route (404 until Task 10, that is expected). `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` green.

- [ ] **Step 4: commit** — `git add -A && git commit -m "feat: playlists list page"`

---

## Task 10: /playlists/[id] editor

**Files:**
- Create: `src/app/(app)/playlists/[id]/page.tsx`
- Create: `src/components/app/playlists/{playlist-editor,playlist-item-row,add-media-dialog,assigned-screens-panel,playlist-settings-dialog}.tsx`
- Test: `src/components/app/playlists/playlist-editor.test.tsx`

**Interfaces:**
- Consumes: `requireRole("playlist.view")`, `ctx.db`, `can`, `storage.createDownloadUrl`, all Task 4/5/6 actions, `MediaCard` (read-only reuse) or a lighter media tile, existing dialog / dropdown / button / input primitives, `sonner`, `useRouter`.
- Produces:
  - `[id]/page.tsx` (server): `notFound()` if the playlist is not in the org. One `withOrgTransaction`: the playlist (`id, name, description, revision, defaultImageDurationSeconds, defaultWebDurationSeconds, archivedAt`), its items `orderBy: { position: "asc" }` each with `mediaAsset` (`id, name, kind, status, archivedAt, thumbnailKey, durationSeconds`), the org's screens (`id, name, location: { name }, playlistId`). Pre-sign each item asset's `thumbnailKey` (`createDownloadUrl(key, 3600)`, `null` when absent). Render `<PlaylistEditor ...serializable props... canUpdate canDelete canAssign />`.
  - `PlaylistEditor` (`"use client"`): renders the item list (`PlaylistItemRow` each), a running total-duration readout, an "Add media" button (opens `AddMediaDialog`), a settings button (opens `PlaylistSettingsDialog`), the `AssignedScreensPanel`, and a delete-playlist control (confirm dialog) when `canDelete`. All mutations call the server action then `router.refresh()`.
  - `PlaylistItemRow`: thumbnail (`<img src={thumbnailUrl}>` or a kind glyph), name, kind `Badge`, an "Unavailable" badge when `asset.archivedAt` or `asset.status !== "READY"`, a duration number input (empty shows placeholder "default"; blur/enter calls `setItemDuration`), an enable/disable toggle (`setItemEnabled`), up / down buttons (call `reorderItems` with the swapped order) and a remove button (`removeItem`). Optional `draggable` handle that on drop calls `reorderItems`.
  - `AddMediaDialog`: a dialog showing the org's non-archived READY assets in a selectable grid (reuse `MediaCard` in a read-only mode or a compact tile); "Add selected" calls `addItems(playlistId, { mediaAssetIds })`.
  - `AssignedScreensPanel`: the org's screens, each with a checkbox reflecting `screen.playlistId === thisPlaylistId`; toggling calls `assignPlaylistToScreen(screenId, checked ? thisPlaylistId : null)`; disabled unless `canAssign`.
  - `PlaylistSettingsDialog`: name, description, default image/web durations; submit calls `updatePlaylist`.

- [ ] **Step 1: `playlist-editor.test.tsx` (jsdom, write, run, fail)** — mock the actions module, `sonner`, `next/navigation`. Render `PlaylistEditor` with 3 items (one with `asset.archivedAt` set). Assert: 3 rows render in order; the archived one shows "Unavailable"; clicking the down button on row 0 calls `reorderItems` with `itemIds` = `[id1, id0, id2]`; clicking remove on row 1 calls `removeItem(id1)`; the running total shows the sum of resolved durations; the delete-playlist control is absent when `canDelete={false}`.

- [ ] **Step 2: implement** the five components and the page. Watch the RSC boundary: `page.tsx` passes only serializable data (dates to labels, no closures). Run the component test — PASS.

- [ ] **Step 3:** `npm run dev` + `npm run storage:up` — full manual pass: open a playlist, add 3 assets, reorder, set a duration, disable one, assign to a screen, remove one, open settings and change a default. `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` green.

- [ ] **Step 4: commit** — `git add -A && git commit -m "feat: playlist editor page and components"`

---

## Task 11: Cross-tenant isolation tests

**Files:**
- Modify: `src/test/isolation/tenant-isolation.spec.ts`

**Interfaces:**
- Consumes: the playlist actions, `forOrg`, `withOrgTransaction`, the existing org-A / org-B fixture.

- [ ] **Step 1: extend the fixture** — org B also gets a `Playlist` with one `PlaylistItem` (referencing a B `MediaAsset`) and a B `Screen`. Return `bPlaylistId`, `bItemId`, `bScreenId` (a B screen may already exist in the fixture; reuse it).

- [ ] **Step 2: add cases** (org A context, B ids):
  - `forOrg(A).playlist.findMany()` / `.playlistItem.findMany()` never contain B's rows; `findUnique({ where: { id: bPlaylistId } })` is `null`.
  - `updatePlaylist(bPlaylistId, {...})`, `archivePlaylist(bPlaylistId)`, `deletePlaylist(bPlaylistId)`, `addItems(bPlaylistId, {...})`, `reorderItems(bPlaylistId, {...})`, `removeItem(bItemId)`, `setItemDuration(bItemId, {...})`, `setItemEnabled(bItemId, false)`, `assignPlaylistToScreen(bScreenId, bPlaylistId)` each return `{ error }` / throw and leave B's rows byte-unchanged (deep-equal before/after via the raw `prisma` client; B item count unchanged).
  - `addItems` with a valid A playlist but a **B** `mediaAssetId` → `{ error }`, no item created.
  - `withOrgTransaction(A.id, tx => tx.$queryRawUnsafe('SELECT id FROM "Playlist"'))` returns none of B's ids; same for `"PlaylistItem"`.

- [ ] **Step 2: run** `npm run test -- src/test/isolation/tenant-isolation.spec.ts` — PASS. Full suite green.

- [ ] **Step 3: commit** — `git add -A && git commit -m "test: tenant isolation for playlists"`

---

## Task 12: e2e, docs, demo script

**Files:**
- Create: `src/test/e2e/playlists.spec.ts`
- Modify: `docs/architecture.md`
- Create: `scripts/simulate-playlists.ts`

**Interfaces:**
- Consumes: the built app + local Postgres (`lynesign_test`) + MinIO. `pretest:e2e` already runs `db:test:setup && storage:up`.

- [ ] **Step 1: `src/test/e2e/playlists.spec.ts`** — `beforeAll` `resetDb()` + `seedPlans()`. One test:
  - register a fresh user + org.
  - seed 3 `MediaAsset` rows directly (2 images using the existing `src/test/fixtures/sample.png` uploaded to MinIO with a real `storageKey` + thumbnail, 1 web asset) OR upload via the `/media` UI if simpler; assign them to the new org.
  - go to `/playlists`, create "Lobby Loop", land on the editor.
  - add the 3 assets, assert 3 rows.
  - reorder: move the last item up once, assert the new order in the DOM.
  - set item 1's duration to `7`.
  - open "Assigned screens", check a screen (seed one screen + location first, or create via `/screens`).
  - via `request.post("/api/player/pair", ...)` with that screen's pairing code, get a device token.
  - `request.get("/api/player/sync", { headers: { Authorization: \`Bearer ${token}\` } })` → assert `playlist.items` length 3, order matches the reorder, item 1 `durationSeconds` is `7`, and the first image `url` returns `200` when fetched.

- [ ] **Step 2: docs** — `docs/architecture.md`: add a `## Playlists` section (the two models + `Screen.playlistId`; on-demand assembly; the `revision` monotonic-int contract; the sync payload shape; the documented limitation that `revision` does not capture asset edits). Update the "Recommended next steps" roadmap list to mark playlists done and renumber. Grep every symbol/path cited to confirm it exists.

- [ ] **Step 3: `scripts/simulate-playlists.ts`** — match the `simulate-*.ts` family (doc comment, `main()`, re-run safe with `--force`, `prisma` + `withOrgTransaction`, `console.table` summary). For "Costa Signage Co": build "Storefront Loop" (all Promotions + Brand images, image default 8s) and "Menu Rotation" (the three menu boards, 12s each via per-item duration), then `assignPlaylistToScreen` "Storefront Loop" to the Downtown Flagship screens and "Menu Rotation" to the Warehouse Breakroom screen. Excluded from typecheck by the existing `scripts/simulate-*.ts` pattern. Run it once against the dev DB and paste the summary into the task report.

- [ ] **Step 4:** `npm run storage:up && npm run test:e2e` — the playlist spec passes, `core-journey` / `media` / `users-table` still green. Full `npm run test`, `npm run lint`, `npm run typecheck` green.

- [ ] **Step 5: commit** — `git add -A && git commit -m "test: end-to-end playlist journey; docs and demo script"`

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 2 In scope 1 (models, migration, RLS, list sync) | 1 |
| 2 In scope 2 (`playlist.*` RBAC, nav gate) | 2 |
| 2 In scope 3 (validation module) | 1 |
| 2 In scope 4 (playlist + item + assign actions) | 4, 5, 6 |
| 2 In scope 5 (`Screen.playlistId`, screen-form select) | 1 (column), 6 (form) |
| 2 In scope 6 (manifest fn + sync wiring) | 3, 7 |
| 2 In scope 7 (list page + editor) | 9, 10 |
| 2 In scope 8 (tests) | every task + 11 (isolation) + 12 (e2e) |
| 2 In scope 9 (`purgeArchivedMedia` guard) | 8 |
| 3.1 revision + `bumpRevision` single writer | 4 (helper), 4/5/6 (callers) |
| 3.2 integer position, no unique, permutation rewrite, `0..n-1` test | 5 |
| 4.1 `Playlist` model | 1 |
| 4.2 `PlaylistItem` model, `onDelete: Restrict` | 1 |
| 4.3 `Screen.playlistId` SetNull | 1 |
| 4.4 RLS + facade + triplicated list | 1 |
| 5 zod schemas | 1 |
| 6 server actions table | 4, 5, 6 |
| 6 `GET /api/player/sync` rewrite, `canvas` key removed | 7 |
| 7 `assembleManifest` rules | 3 |
| 8 purge worker fix | 8 |
| 9 RBAC table + nav | 2 |
| 10.1 list page | 9 |
| 10.2 editor + six components | 9 (2 of them), 10 (five) |
| 10.3 screen form select | 6 |
| 11 unit / integration / isolation / worker / e2e | 3, 1, 4, 5, 6, 7 / 11 / 8 / 12 |
| 11 documented limitation | 12 (docs) |
| 12 deliverables | all |
| 13 risks | acknowledged; no task needed |

**Placeholder scan** — no `TBD` / `TODO` / "add validation" / "handle errors" / "similar to Task N". Every action has an explicit signature, role, and behavior. The migration RLS block is given in full. The zod schemas are given in full. `assembleManifest`'s signature and every skip/duration rule is enumerated. The one "identify the exact files" instruction (Task 6, screen form) is a read-first directive with the likely filenames named, not a missing decision.

**Type consistency** — `bumpRevision(tx, playlistId)` signature is fixed in Task 4 and called in Tasks 4, 5. `assembleManifest`'s arg shape (Task 3) is exactly what Task 7 assembles and passes. The `ManifestItem` fields (`id, kind, url, durationSeconds, mimeType, width, height`) match the spec §6 payload and the §7 interface. `playlist.*` action strings are identical across Tasks 2, 4, 5, 6, 7, 9, 10. `Playlist.revision` is `Int @default(1)` in Task 1 and incremented (never set absolutely) everywhere. `PlaylistItem.position` is `Int`, 0-based, contiguous, asserted in Task 5. `assignPlaylistToScreen` explicitly does **not** bump revision in both the spec and Tasks 6 and 11. `TENANT_MODELS` / `TENANT_TABLES` / RLS `ARRAY` all reach 27 in Task 1 and `tenant-model-list.test.ts` enforces it.
