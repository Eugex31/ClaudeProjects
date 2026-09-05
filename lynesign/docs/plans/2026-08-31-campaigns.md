# Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship LyneSign Campaigns -- run an existing Playlist across a group of screens for a date window, taking over each targeted screen's base playlist while active, delivered through `GET /api/player/sync`.

**Architecture:** Three new tenant-scoped, RLS-forced tables (`Campaign`, `CampaignScreen`, `CampaignLocation`). A pure `resolveScreenContent` picks, for one screen at one instant, the highest-priority active campaign that targets it (directly or via its location), or falls back to `Screen.playlistId`. `Campaign.revision` is a monotonic int for device change detection. The sync route resolves the effective playlist and then assembles its manifest with the existing `assembleManifest`. No new dependencies; no interleave/append modes; no day/time recurrence (that is the Schedule increment).

**Tech Stack:** Next.js 16.2.11, React 19, Prisma 6.19.x + `@prisma/adapter-pg`, PostgreSQL, `zod@^4`, Vitest, Playwright.

**Spec:** `docs/specs/2026-08-31-campaigns-design.md`

## Global Constraints

- Branch `campaigns` off `main` (merge-base at the `feat: playlist preview player` commit; the branch already carries the `docs: campaigns design spec` commit). Runtime pins unchanged (`next@16.2.11`, `react@19.2.4`, `prisma`/`@prisma/client`/`@prisma/adapter-pg@^6.19.x`, `zod@^4`). TypeScript `strict`.
- Every tenant-data read/write goes through `forOrg` / `withOrgTransaction`. `Campaign`, `CampaignScreen`, `CampaignLocation` are added to **all three** lists -- the `*_rls*` migration `ARRAY`, `TENANT_MODELS` (`src/lib/db/tenant.ts`, camelCase `"campaign"` / `"campaignScreen"` / `"campaignLocation"`), `TENANT_TABLES` (`src/test/isolation/tenant-tables.ts`, PascalCase) -- each reaching 30; `src/lib/db/tenant-model-list.test.ts` must stay green.
- The device-authed `src/app/api/player/sync/route.ts` uses the root `prisma` client and is already in the ESLint `RAW_PRISMA_ALLOWED` allow-list (`src/app/api/player/**`). Every read in it stays scoped with `organizationId: screen.organizationId`.
- RLS policy predicate for the new tables is **byte-identical** to migration `20260830032500_rls_empty_guc_is_unscoped`: `coalesce(current_setting('app.current_org', true), '') = '' OR "organizationId" = current_setting('app.current_org', true)`, both USING and WITH CHECK, with `ENABLE` + `FORCE ROW LEVEL SECURITY`. Match the hand-appended `DO $$` block style in `prisma/migrations/20260831055827_playlists/migration.sql`.
- Every mutating server action: `requireRole(<action>)` as the first statement, then `safeParse`, then work inside `withOrgTransaction`, then `bumpCampaignRevision` where the campaign or its targets changed, then `writeAudit(...)`, then `revalidatePath`. `archiveCampaign` / `restoreCampaign` / `deleteCampaign` do **not** bump. `redirect()` (if any) stays outside try/catch. Every caller-supplied id is resolved through `ctx.db`.
- Campaign window is **half-open**: a campaign is a candidate when `startsAt <= now` AND `now < endsAt`.
- Copy rules: no em dashes, no emojis, no exclamation points in any user-facing string, error, toast, log line, audit action, or doc prose. End error strings with a period.
- No new npm dependencies. Datetime entry is `<input type="datetime-local">`; store as a UTC `DateTime`.
- RSC boundary: `page.tsx` server components pass only serializable props into `"use client"` children -- no function/render-closure props, no `Date` objects (send ISO strings or precomputed labels).
- TDD: write the failing test, run it and watch it fail, implement the minimum, run it and watch it pass, commit. Conventional Commits.
- Commands run from `lynesign/`. `npm run db:up` and `npm run storage:up` must both be running for integration/e2e suites. If Postgres will not start with "not accepting connections", `rm -f .pgdata/postmaster.pid` then retry.
- A concurrent session may have uncommitted edits to `tsconfig.json` / `scripts/simulate-*.ts` in the working tree. They are not part of this branch. Do not touch them; confirm zero NEW problems in `src/` / `prisma/` only. For a clean `next build` / e2e, use a throwaway worktree at the task HEAD.
- Known baseline: `npm run test` is 294 passing on `main` with services up.

---

## File Structure

```
lynesign/
  prisma/
    schema.prisma                                   # + Campaign, CampaignScreen, CampaignLocation, back-relations
    migrations/<ts>_campaigns/migration.sql          # 3 tables + FKs + RLS DO block
  src/
    lib/
      db/tenant.ts                                  # TENANT_MODELS += campaign, campaignScreen, campaignLocation
      rbac/policy.ts                                # Action union + POLICY += campaign.*
      nav.ts                                        # /campaigns item gets action: "campaign.view"
      validation/campaigns.ts                       # NEW - zod schemas
      campaigns/revision.ts                         # NEW - bumpCampaignRevision(tx, campaignId)
      player/campaign.ts                            # NEW - resolveScreenContent, ScreenContent
    test/isolation/tenant-tables.ts                 # TENANT_TABLES += Campaign, CampaignScreen, CampaignLocation
    app/
      (app)/campaigns/
        actions.ts                                  # NEW - all server actions
        page.tsx                                    # replace ComingSoon - list
        [id]/page.tsx                               # NEW - editor server component
      (app)/playlists/actions.ts                    # deletePlaylist gains a campaign guard
      api/player/sync/route.ts                      # resolveScreenContent + source/campaign in the payload
      api/campaigns/[id]/preview/route.ts           # NEW - session-authed campaign manifest
    components/app/campaigns/                        # NEW
      campaign-list.tsx
      new-campaign-dialog.tsx
      campaign-editor.tsx
      campaign-targets-panel.tsx
    components/app/playlists/playlist-preview-dialog.tsx   # optional fetchPath prop
  docs/architecture.md                              # + Campaigns section, roadmap update
  scripts/simulate-campaigns.ts                      # NEW - demo data (excluded from typecheck)
  src/test/
    lib/player/campaign.test.ts                      # NEW
    lib/validation/campaigns.test.ts                 # NEW
    app/(app)/campaigns/campaigns.test.ts            # NEW - action integration
    app/api/player/sync/sync.test.ts                 # extend - campaign cases
    app/api/campaigns/[id]/preview/preview.test.ts   # NEW
    isolation/tenant-isolation.spec.ts              # + campaign cases
    components/app/campaigns/*.test.tsx              # NEW
    e2e/campaigns.spec.ts                            # NEW
```

---

## Task 1: Schema, migration, RLS, list sync, validation module

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_campaigns/migration.sql`
- Modify: `src/lib/db/tenant.ts`, `src/test/isolation/tenant-tables.ts`
- Create: `src/lib/validation/campaigns.ts`
- Test: `prisma/campaigns-schema.test.ts`, `src/lib/validation/campaigns.test.ts`
- Existing test that must stay green: `src/lib/db/tenant-model-list.test.ts`

**Interfaces:**
- Produces:
  - `Campaign` model exactly as spec section 4.1: `id`, `organizationId`, `name`, `description String?`, `playlistId`, `startsAt`/`endsAt`/`archivedAt` `DateTime @db.Timestamptz(3)`, `priority Int @default(0)`, `enabled Boolean @default(true)`, `revision Int @default(1)`, `createdByUserId String?`, timestamps. Relations: `organization` `onDelete: Cascade`, `playlist Playlist @relation(onDelete: Restrict)`, `createdBy User? @relation("CampaignCreator", onDelete: SetNull)`, `screens CampaignScreen[]`, `locations CampaignLocation[]`. Indexes: `@@index([organizationId])`, `@@index([organizationId, archivedAt])`, `@@index([organizationId, enabled, startsAt, endsAt])`, `@@index([playlistId])`.
  - `CampaignScreen`: `id`, `organizationId`, `campaignId`, `screenId`; relations `organization`/`campaign`/`screen` all `onDelete: Cascade`; `@@unique([campaignId, screenId])`, `@@index([organizationId])`, `@@index([screenId])`.
  - `CampaignLocation`: same shape with `locationId`; `@@unique([campaignId, locationId])`, `@@index([organizationId])`, `@@index([locationId])`.
  - Back-relations: `Playlist.campaigns Campaign[]`, `Screen.campaignScreens CampaignScreen[]`, `Location.campaignLocations CampaignLocation[]`, `Organization.campaigns` / `campaignScreens` / `campaignLocations`, `User.createdCampaigns Campaign[] @relation("CampaignCreator")`.
  - `src/lib/validation/campaigns.ts` exports `createCampaignSchema`, `updateCampaignSchema`, `setTargetsSchema`, `idSchema`.

- [ ] **Step 1: schema text test (write, run, fail)** -- `prisma/campaigns-schema.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const schema = readFileSync("prisma/schema.prisma", "utf8");
it("Campaign, CampaignScreen, CampaignLocation exist", () => {
  expect(schema).toMatch(/model Campaign \{/);
  expect(schema).toMatch(/model CampaignScreen \{/);
  expect(schema).toMatch(/model CampaignLocation \{/);
  expect(schema).toMatch(/revision\s+Int\s+@default\(1\)/);
});
it("Campaign.playlist is onDelete Restrict", () => {
  const block = schema.match(/model Campaign \{[\s\S]*?\n\}/)![0];
  expect(block).toMatch(/playlist\s+Playlist\s+@relation\([^)]*onDelete:\s*Restrict/);
});
it("the join tables have their composite unique keys", () => {
  expect(schema).toMatch(/@@unique\(\[campaignId, screenId\]\)/);
  expect(schema).toMatch(/@@unique\(\[campaignId, locationId\]\)/);
});
```
Run: `npm run test -- prisma/campaigns-schema.test.ts` -- FAIL.

- [ ] **Step 2: edit `prisma/schema.prisma`** per the Interfaces block. `npx prisma generate` (exit 0; if it EPERMs on a locked query engine DLL because a dev server is running, kill the dev server or note it -- the TS client still regenerates). Re-run the schema test -- PASS.

- [ ] **Step 3: create the migration** -- `npx prisma migrate dev --name campaigns --create-only`, then hand-append the RLS block:
```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Campaign','CampaignScreen','CampaignLocation'] LOOP
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
(Open `prisma/migrations/20260831055827_playlists/migration.sql` and match its block byte for byte apart from the table-name array.)

- [ ] **Step 4: apply and verify** -- `npx prisma migrate deploy`. Then a node/pg check as `lynesign_app`: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('Campaign','CampaignScreen','CampaignLocation')` -> all `t | t`; `SELECT c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname IN ('Campaign','CampaignScreen','CampaignLocation')` -> `tenant_isolation` on each. Confirm the full history applies from empty against a throwaway `lynesign_camptest` database (`CREATE DATABASE` as `lynesign_app`, `DATABASE_URL=... npx prisma migrate deploy`, `DROP DATABASE`).

- [ ] **Step 5: list sync** -- `TENANT_MODELS` += `"campaign"`, `"campaignScreen"`, `"campaignLocation"` (30). `TENANT_TABLES` += `"Campaign"`, `"CampaignScreen"`, `"CampaignLocation"` (30). Run `npm run test -- src/lib/db/tenant-model-list.test.ts` -- PASS.

- [ ] **Step 6: validation test (write, run, fail)** -- `src/lib/validation/campaigns.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createCampaignSchema, updateCampaignSchema, setTargetsSchema } from "@/lib/validation/campaigns";

const base = {
  name: "Fall Sale",
  playlistId: "pl1",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-15T00:00:00.000Z",
};
it("createCampaignSchema accepts a valid window and rejects a reversed one", () => {
  expect(createCampaignSchema.safeParse(base).success).toBe(true);
  expect(createCampaignSchema.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
  expect(createCampaignSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
});
it("priority is bounded 0..1000", () => {
  expect(createCampaignSchema.safeParse({ ...base, priority: -1 }).success).toBe(false);
  expect(createCampaignSchema.safeParse({ ...base, priority: 1001 }).success).toBe(false);
  expect(createCampaignSchema.safeParse({ ...base, priority: 10 }).success).toBe(true);
});
it("bad ISO datetime is rejected", () => {
  expect(createCampaignSchema.safeParse({ ...base, startsAt: "next tuesday" }).success).toBe(false);
});
it("updateCampaignSchema rejects a reversed window only when both are present", () => {
  expect(updateCampaignSchema.safeParse({ name: "x" }).success).toBe(true);
  expect(updateCampaignSchema.safeParse({ startsAt: base.endsAt, endsAt: base.startsAt }).success).toBe(false);
  expect(updateCampaignSchema.safeParse({ endsAt: base.endsAt }).success).toBe(true);
});
it("setTargetsSchema needs at least one target and caps the arrays", () => {
  expect(setTargetsSchema.safeParse({ screenIds: [], locationIds: [] }).success).toBe(false);
  expect(setTargetsSchema.safeParse({ screenIds: ["s1"], locationIds: [] }).success).toBe(true);
  expect(setTargetsSchema.safeParse({ screenIds: Array(1001).fill("s"), locationIds: [] }).success).toBe(false);
});
```
Run -- FAIL.

- [ ] **Step 7: implement `src/lib/validation/campaigns.ts`**:
```ts
import { z } from "zod";

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500);
const priority = z.number().int().min(0).max(1000);
const isoDate = z.string().datetime();
export const idSchema = z.string().min(1);

export const createCampaignSchema = z
  .object({
    name,
    description: description.optional(),
    playlistId: z.string().min(1),
    startsAt: isoDate,
    endsAt: isoDate,
    priority: priority.optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "The end must be after the start.",
    path: ["endsAt"],
  });

export const updateCampaignSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    playlistId: z.string().min(1).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
    priority: priority.optional(),
  })
  .refine(
    (v) =>
      v.startsAt == null ||
      v.endsAt == null ||
      new Date(v.endsAt) > new Date(v.startsAt),
    { message: "The end must be after the start.", path: ["endsAt"] },
  );

export const setTargetsSchema = z
  .object({
    screenIds: z.array(z.string().min(1)).max(1000),
    locationIds: z.array(z.string().min(1)).max(1000),
  })
  .refine((v) => v.screenIds.length + v.locationIds.length > 0, {
    message: "Choose at least one screen or location.",
  });
```
Run -- PASS. Full `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 8: commit** -- `git add -A -- ':!tsconfig.json' ':!scripts/simulate-*.ts' && git commit -m "feat: campaign schema, RLS, and validation module"` (stage explicitly if the pathspec exclude is awkward; confirm `git show --stat HEAD` excludes `tsconfig.json` and the simulate scripts).

---

## Task 2: RBAC actions and nav gate

**Files:** Modify `src/lib/rbac/policy.ts`, `src/lib/nav.ts`; extend `src/lib/rbac/can.test.ts`, `src/lib/nav.test.ts`.

**Interfaces:**
- Produces: `Action` union += `"campaign.view" | "campaign.create" | "campaign.update" | "campaign.delete"`. `POLICY`: `campaign.view` -> `ALL`; `campaign.create` / `campaign.update` / `campaign.delete` -> `MANAGERS_UP`. `/campaigns` nav item gains `action: "campaign.view"`.

- [ ] **Step 1: extend `can.test.ts`** (match the file's existing `actor(role)` helper):
```ts
it("campaign permissions by role", () => {
  expect(can(actor("VIEWER"), "campaign.view")).toBe(true);
  expect(can(actor("CONTENT_MANAGER"), "campaign.view")).toBe(true);
  expect(can(actor("CONTENT_MANAGER"), "campaign.create")).toBe(false);
  expect(can(actor("MANAGER"), "campaign.create")).toBe(true);
  expect(can(actor("MANAGER"), "campaign.update")).toBe(true);
  expect(can(actor("MANAGER"), "campaign.delete")).toBe(true);
});
```
Run -- FAIL.

- [ ] **Step 2:** add the four strings to the `Action` union and the four `POLICY` rows (grouped next to the `playlist.*` rows). Run `can.test.ts` -- PASS.

- [ ] **Step 3: nav** -- add `action: "campaign.view"` to the `/campaigns` entry; update `src/lib/nav.test.ts` if it asserts per-item actions. Run -- PASS.

- [ ] **Step 4:** full `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 5: commit** -- `git add src/lib/rbac/policy.ts src/lib/rbac/can.test.ts src/lib/nav.ts src/lib/nav.test.ts && git commit -m "feat: campaign RBAC actions and nav gate"` (drop `nav.test.ts` if unchanged).

---

## Task 3: `resolveScreenContent` pure function

**Files:** Create `src/lib/player/campaign.ts`; test `src/lib/player/campaign.test.ts`.

**Interfaces:**
- Produces `resolveScreenContent(args)` and `ScreenContent` exactly as spec section 3.2. Pure, no I/O, never throws. `campaignEndsAt` in the result is an ISO string (`campaign.endsAt.toISOString()`).

- [ ] **Step 1: test (write, run, fail)** -- `src/lib/player/campaign.test.ts`. `now = new Date("2026-09-05T12:00:00.000Z")`. Helper to build a campaign with overridable fields (`enabled: true`, `archivedAt: null`, window `2026-09-01 .. 2026-09-10`, `priority: 0`, `screenIds: []`, `locationIds: []`). A screen `{ id: "s1", locationId: "loc1", playlistId: "base-pl" }`. Cases:
  - no campaigns -> `{ source: "playlist", playlistId: "base-pl" }`.
  - no campaigns, `screen.playlistId: null` -> `{ source: "none" }`.
  - one candidate targeting `screenIds: ["s1"]` -> `{ source: "campaign", campaignId, playlistId: <its>, campaignEndsAt: "2026-09-10T00:00:00.000Z" }`.
  - one candidate targeting `locationIds: ["loc1"]` (screen's location) -> campaign.
  - a campaign targeting `screenIds: ["other"]` and `locationIds: ["other"]` -> ignored (falls to base).
  - `enabled: false` -> ignored; `archivedAt: new Date()` -> ignored.
  - window `startsAt` exactly `now` -> candidate; window `endsAt` exactly `now` -> NOT a candidate (half-open).
  - two candidates, priorities 5 and 10 -> the priority-10 one.
  - two candidates, equal priority, `endsAt` `2026-09-08` vs `2026-09-12` -> the `2026-09-08` one.
  - two candidates, equal priority and `endsAt`, ids `"a"` and `"b"` -> `"a"` (deterministic).

- [ ] **Step 2: implement `src/lib/player/campaign.ts`** to make it pass. One exported function + the `ScreenContent` union type.

- [ ] **Step 3:** run the test -- PASS. `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** -- `git add src/lib/player/campaign.ts src/lib/player/campaign.test.ts && git commit -m "feat: resolve a screen's effective content from campaigns"`

---

## Task 4: `bumpCampaignRevision` + campaign CRUD actions

**Files:** Create `src/lib/campaigns/revision.ts`, `src/app/(app)/campaigns/actions.ts` (CRUD only; Task 5 appends `setCampaignTargets`); test `src/app/(app)/campaigns/campaigns.test.ts`.

**Interfaces:**
- Consumes: `requireRole` (`@/lib/auth/context`), `withOrgTransaction` (`@/lib/db/tenant`), `writeAudit` (`@/lib/audit`), `revalidatePath` (`next/cache`), the Task 1 schemas, `NotFoundError` (`@/lib/errors`).
- Produces:
  - `bumpCampaignRevision(tx, campaignId: string): Promise<void>` -- `tx.campaign.update({ where: { id: campaignId }, data: { revision: { increment: 1 } } })`. Type `tx` with the exported tenant-transaction client type (see `src/lib/db/tenant.ts`; `src/lib/playlists/revision.ts` is the precedent).
  - `createCampaign(input: { name; description?; playlistId; startsAt; endsAt; priority? }): Promise<{ id: string } | { error: string }>` -- `requireRole("campaign.create")`; `createCampaignSchema`; `playlistId` must resolve via `ctx.db.playlist.findUnique` and `archivedAt == null` else `{ error: "Choose a playlist from your organization." }`; create with `organizationId`, `createdByUserId: ctx.user.id`, `priority: input.priority ?? 0`, `startsAt`/`endsAt` as `new Date(...)`; audit `campaign.create`; `revalidatePath("/campaigns")`.
  - `updateCampaign(id, patch): Promise<{ error?: string }>` -- `requireRole("campaign.update")`; `idSchema` + `updateCampaignSchema`; campaign resolves via `ctx.db` else `NotFoundError`; if `patch.playlistId` set it must resolve + be non-archived; compute effective `startsAt` = `patch.startsAt ?? stored`, effective `endsAt` = `patch.endsAt ?? stored`, and if `!(new Date(effectiveEndsAt) > new Date(effectiveStartsAt))` return `{ error: "The end must be after the start." }`; update inside `withOrgTransaction` (only the keys present in `patch`; `description` may be set to `null`), then `bumpCampaignRevision`; audit `campaign.update`; `revalidatePath("/campaigns")` and `/campaigns/${id}`.
  - `setCampaignEnabled(id, enabled: boolean): Promise<{ error?: string }>` -- `requireRole("campaign.update")`; `z.boolean()` guard + `idSchema`; resolve via `ctx.db`; update `enabled`, `bumpCampaignRevision`; audit `campaign.enabled`.
  - `archiveCampaign(id): Promise<{ error?: string }>` -- `requireRole("campaign.delete")`; resolve; set `archivedAt = new Date()`; **no bump**; audit `campaign.archive`; revalidate both paths.
  - `restoreCampaign(id): Promise<{ error?: string }>` -- `requireRole("campaign.update")`; resolve; clear `archivedAt`; **no bump**; audit `campaign.restore`.
  - `deleteCampaign(id): Promise<{ error?: string }>` -- `requireRole("campaign.delete")`; resolve; `ctx.db.campaign.delete` (cascades the join rows); audit `campaign.delete`; `revalidatePath("/campaigns")`.

- [ ] **Step 1: tests (write, run, fail)** -- `src/app/(app)/campaigns/campaigns.test.ts`, real DB, mock `next/cache` `revalidatePath`, mock `@/lib/auth/context` `requireRole`/`requireOrg` to a bound org-A context (pattern: `src/app/(app)/playlists/playlists.test.ts`). `beforeEach` does `resetDb()` + `seedPlans()` and creates an `Organization`, a `User`, and a `Playlist` in that org (campaigns need one). Cases:
  - `createCampaign` with the org playlist and a valid window -> `{ id }`; row has `revision: 1`, `priority: 0`, `createdByUserId` set; audit `campaign.create` exists.
  - `createCampaign` with an archived playlist -> `{ error }`, no row.
  - `createCampaign` with a reversed window -> `{ error }` (from zod).
  - `updateCampaign(id, { priority: 20 })` -> updated; `revision` is 2.
  - `updateCampaign(id, { startsAt: <after stored endsAt> })` (one-sided) -> `{ error }`, unchanged.
  - `updateCampaign("nope", {...})` -> throws `NotFoundError`.
  - `setCampaignEnabled(id, false)` -> `enabled` false; `revision` bumped.
  - `archiveCampaign(id)` -> `archivedAt` set; `revision` UNCHANGED.
  - `restoreCampaign(id)` -> `archivedAt` null; `revision` unchanged.
  - `deleteCampaign(id)` -> row gone.

- [ ] **Step 2: implement** `src/lib/campaigns/revision.ts` then the CRUD half of `actions.ts` (`"use server"` at top). Run tests -- PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** -- `git add src/lib/campaigns/revision.ts "src/app/(app)/campaigns/actions.ts" "src/app/(app)/campaigns/campaigns.test.ts" && git commit -m "feat: campaign create, update, enable, archive, and delete actions"`

---

## Task 5: `setCampaignTargets` action

**Files:** Modify `src/app/(app)/campaigns/actions.ts` (append); modify `src/app/(app)/campaigns/campaigns.test.ts` (append).

**Interfaces:**
- Produces `setCampaignTargets(id: string, input: { screenIds: string[]; locationIds: string[] }): Promise<{ error?: string }>` -- `requireRole("campaign.update")` first; `idSchema` + `setTargetsSchema`; campaign resolves via `ctx.db` else `NotFoundError`. Validate ownership of every id in one query each: `const screens = await ctx.db.screen.findMany({ where: { id: { in: [...new Set(input.screenIds)] } }, select: { id: true } })` and likewise `ctx.db.location`; if `screens.length !== new Set(input.screenIds).size` or the location count mismatches -> `{ error: "One of those targets is not in your organization." }`, no writes. Inside `withOrgTransaction`:
  - `tx.campaignScreen.deleteMany({ where: { campaignId: id, screenId: { notIn: input.screenIds } } })` then `tx.campaignScreen.createMany({ data: <ids not already present>.map(screenId => ({ organizationId: ctx.organizationId, campaignId: id, screenId })), skipDuplicates: true })`.
  - same for `campaignLocation` with `locationId`.
  - `bumpCampaignRevision(tx, id)`.
  Audit `campaign.targets` with `metadata: { screens: input.screenIds.length, locations: input.locationIds.length }`. `revalidatePath("/campaigns")` and `/campaigns/${id}`.

- [ ] **Step 1: tests (append, run, fail)** -- extend the fixture to create real `Location` + `Screen` rows in org A. Cases:
  - `setCampaignTargets(id, { screenIds: [s1, s2], locationIds: [loc1] })` -> three join rows exist; `revision` bumped by 1.
  - a second call `{ screenIds: [s2], locationIds: [] }` -> `s1` and `loc1` rows gone, `s2` row kept, no duplicate; `revision` bumped.
  - `setCampaignTargets(id, { screenIds: [], locationIds: [] })` -> `{ error }` (zod), no change.
  - `setCampaignTargets(id, { screenIds: ["not-in-org"], locationIds: [] })` -> `{ error }`, no change.
  - a cross-org screen id (create a second org + screen) -> `{ error }`, no change.

- [ ] **Step 2: implement.** Run tests -- PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** -- `git add "src/app/(app)/campaigns/actions.ts" "src/app/(app)/campaigns/campaigns.test.ts" && git commit -m "feat: set a campaign's screen and location targets"`

---

## Task 6: `deletePlaylist` campaign guard

**Files:** Modify `src/app/(app)/playlists/actions.ts`; modify `src/app/(app)/playlists/playlists.test.ts` (append).

**Interfaces:**
- Produces: `deletePlaylist` gains a guard -- after resolving the playlist via `ctx.db` and before `ctx.db.playlist.delete`, `const usedByCampaign = await ctx.db.campaign.count({ where: { playlistId: id } });` and if `> 0` return `{ error: "That playlist is used by a campaign. Remove it from the campaign first." }`.

- [ ] **Step 1: test (append, run, fail)** -- in `playlists.test.ts`, create a `Campaign` (needs a window; `startsAt`/`endsAt` any valid pair) referencing a playlist, then `deletePlaylist(thatPlaylistId)` -> `{ error }`, `prisma.playlist.findUnique` still returns it. Keep the existing "deletes a playlist" case green (a playlist with no campaign still deletes).

- [ ] **Step 2: implement** the guard. Run `playlists.test.ts` -- PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** -- `git add "src/app/(app)/playlists/actions.ts" "src/app/(app)/playlists/playlists.test.ts" && git commit -m "fix: block deleting a playlist that a campaign uses"`

---

## Task 7: Wire `GET /api/player/sync`

**Files:** Modify `src/app/api/player/sync/route.ts`; modify `src/app/api/player/sync/sync.test.ts` (append campaign cases).

**Interfaces:**
- Consumes `resolveScreenContent` (Task 3), the existing `assembleManifest` + presign block.
- Produces the payload from spec section 6: `{ screenId, pollIntervalSeconds, source: "campaign" | "playlist" | "none", campaign: {...} | null, playlist: {...} | null }`.

- [ ] **Step 1: tests (append, run, fail)** -- real DB + MinIO. Reuse the file's helpers. Build an org, a location, a paired screen (known `deviceTokenHash`), a base playlist with one READY image item, and a second "campaign" playlist with a different READY image item. Cases:
  - no campaign -> `source: "playlist"`, `campaign: null`, `playlist` is the base playlist manifest.
  - an enabled campaign, window spanning now, `CampaignScreen` for this screen, pointing at the campaign playlist -> `source: "campaign"`, `campaign: { id, name, revision, endsAt }`, `playlist` is the campaign playlist's manifest.
  - a `CampaignLocation` for the screen's location (no `CampaignScreen`) -> same result.
  - two overlapping enabled campaigns, priorities 1 and 5, both targeting the screen -> the priority-5 one's playlist.
  - a campaign whose `endsAt` is in the past -> ignored, `source: "playlist"`.
  - the screen has `playlistId: null` and no campaign -> `source: "none"`, `playlist: null`.
  - `canvas` and a top-level `manifest` key are absent in every case.

- [ ] **Step 2: implement** -- after the auth + actor check and reading `screen`, add the candidate-campaign `findMany` (spec section 6, scoped by `organizationId: screen.organizationId`), map rows to the `resolveScreenContent` campaign shape (`screenIds` from `row.screens.map(s => s.screenId)`, `locationIds` likewise), call `resolveScreenContent({ screen: { id, locationId, playlistId: screen.playlistId }, now: new Date(), campaigns })`. Branch:
  - `source === "none"` -> `return NextResponse.json({ screenId, pollIntervalSeconds, source: "none", campaign: null, playlist: null })`.
  - otherwise take `resolved.playlistId`, run the existing playlist + items + assets + presign + `assembleManifest` block against THAT id (scoped by `organizationId`), and return `{ screenId, pollIntervalSeconds, source: resolved.source, campaign: resolved.source === "campaign" ? { id: resolved.campaignId, name: resolved.campaignName, revision: resolved.campaignRevision, endsAt: resolved.campaignEndsAt } : null, playlist: <manifest or null if the playlist row vanished> }`.
  Keep the whole thing inside `withRequestId` + `try/catch` + `toProblem`.

- [ ] **Step 3:** run `sync.test.ts` -- PASS (existing base-playlist cases stay green -- they now also assert `source: "playlist"`; update them). Full `npm run test`, `npm run typecheck`, `npm run lint` green; `npm run build` compiles the route.

- [ ] **Step 4: commit** -- `git add src/app/api/player/sync/route.ts src/app/api/player/sync/sync.test.ts && git commit -m "feat: player sync resolves an active campaign over the base playlist"`

---

## Task 8: `GET /api/campaigns/[id]/preview` + preview-dialog fetch path

**Files:** Create `src/app/api/campaigns/[id]/preview/route.ts`; modify `src/components/app/playlists/playlist-preview-dialog.tsx`; test `src/app/api/campaigns/[id]/preview/preview.test.ts`.

**Interfaces:**
- Produces:
  - `GET /api/campaigns/[id]/preview` -- `requireRole("campaign.view")`; resolve the campaign via `ctx.db.campaign.findUnique({ where: { id }, select: { playlistId: true } })` else `NotFoundError`; then run the identical playlist-manifest assembly that `src/app/api/playlists/[id]/preview/route.ts` performs on `campaign.playlistId`, returning the same `{ id, name, revision, items }` (the playlist's id/name/revision). If the playlist assembly logic in the playlist preview route can be factored into a shared helper `assemblePlaylistPreview(ctxDb, playlistId)` in `src/lib/player/preview.ts`, do that and call it from both routes; otherwise duplicate the ~30 lines and note it in the report.
  - `PlaylistPreviewDialog` gains an optional prop `fetchPath?: string` (default `/api/playlists/${playlistId}/preview`); when provided it fetches that path instead. `playlistId` stays required (used for the default and as a React key).

- [ ] **Step 1: tests (write, run, fail)** -- `preview.test.ts`, real DB + MinIO, `vi.mock("@/lib/auth/context")` bound-ctx pattern (see `src/app/api/playlists/[id]/preview/preview.test.ts`). Build an org, a playlist with 2 READY items (one with a real MinIO object), a campaign pointing at it. Cases:
  - `GET /api/campaigns/<id>/preview` -> 200; body `items` length 2 in position order; the image item url points at the local storage endpoint; `id`/`name`/`revision` are the playlist's.
  - a campaign in another org -> 404.

- [ ] **Step 2: implement** the route (and the shared helper if you extract it -- if so, refactor `src/app/api/playlists/[id]/preview/route.ts` to call it and keep `src/app/api/playlists/[id]/preview/preview.test.ts` green). Add the `fetchPath` prop to `PlaylistPreviewDialog` and cover it with one added case in `playlist-preview-dialog.test.tsx` (pass `fetchPath="/api/campaigns/c1/preview"`, assert `fetch` was called with that).

- [ ] **Step 3:** run the new + touched tests -- PASS. Full `npm run test`, `npm run typecheck`, `npm run lint` green.

- [ ] **Step 4: commit** -- `git add src/app/api/campaigns "src/lib/player/preview.ts" "src/app/api/playlists/[id]/preview/route.ts" src/components/app/playlists/playlist-preview-dialog.tsx src/components/app/playlists/playlist-preview-dialog.test.tsx && git commit -m "feat: campaign preview route reusing the playlist player"` (drop paths you did not touch).

---

## Task 9: `/campaigns` list page

**Files:** Modify `src/app/(app)/campaigns/page.tsx` (replace `ComingSoon`); create `src/components/app/campaigns/campaign-list.tsx`, `src/components/app/campaigns/new-campaign-dialog.tsx`; test `src/components/app/campaigns/campaign-list.test.tsx`.

**Interfaces:**
- Consumes `requireRole("campaign.view")`, `ctx.db`, `can`, `createCampaign` (Task 4), `PageHeader` / `EmptyState` / `Dialog` / `Select` / `Input` / `Textarea` / `Button` primitives, `sonner`, `useRouter`, `date-fns`.
- Produces:
  - `page.tsx` (server): `requireRole("campaign.view")`; one `withOrgTransaction` -> `campaign.findMany({ where: { archivedAt: null }, orderBy: [{ startsAt: "asc" }], include: { playlist: { select: { name: true } }, _count: { select: { screens: true, locations: true } } } })` and the org's non-archived playlists (`id, name`) for `NewCampaignDialog`. Map to serializable rows `{ id, name, playlistName, windowLabel, status, targetLabel, priority }` where `status` is computed server-side (`Paused` if `!enabled`; else `Scheduled` / `Active` / `Ended` by `now` vs `[startsAt, endsAt)`), `windowLabel` is `format(startsAt, "d MMM") + " to " + format(endsAt, "d MMM")`, `targetLabel` is `${screens} ${screens === 1 ? "screen" : "screens"}` plus `, ${locations} ${locations === 1 ? "location" : "locations"}` when `locations > 0`. Render `<PageHeader title="Campaigns" actions={canCreate ? <NewCampaignDialog playlists={playlists} /> : null}>` + `<CampaignList rows={rows} />`, `<EmptyState>` when empty.
  - `NewCampaignDialog` (`"use client"`): a `Dialog` with name, an optional description, a playlist `<Select>` (options from `playlists`), `datetime-local` start + end inputs, and an optional priority number input. On submit convert the `datetime-local` values to ISO (`new Date(value).toISOString()`), call `createCampaign(...)`; on `{ id }` `router.push(\`/campaigns/${id}\`)`; on `{ error }` inline alert + `toast.error`.
  - `CampaignList`: server component; a table/list linking each row to `/campaigns/${id}` showing name, playlist name, window label, a status `Badge`, target label, priority.

- [ ] **Step 1: `campaign-list.test.tsx` (jsdom, write, run, fail)** -- render `CampaignList` with two rows (`status: "Active"` / `status: "Scheduled"`, different target labels); assert both names, both playlist names, the status texts, and the target labels render. Mock `next/navigation` if a `<Link>` needs it (check `screens-table.test.tsx`).

- [ ] **Step 2: implement** `CampaignList`, `NewCampaignDialog`, `page.tsx`. Run the component test -- PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` green. `npm run dev` -> `/campaigns` shows the empty state; creating one navigates to `/campaigns/<id>` (404 until Task 10 -- expected).

- [ ] **Step 4: commit** -- `git add "src/app/(app)/campaigns/page.tsx" src/components/app/campaigns && git commit -m "feat: campaigns list page"`

---

## Task 10: `/campaigns/[id]` editor

**Files:** Create `src/app/(app)/campaigns/[id]/page.tsx`, `src/components/app/campaigns/campaign-editor.tsx`, `src/components/app/campaigns/campaign-targets-panel.tsx`; test `src/components/app/campaigns/campaign-editor.test.tsx`.

**Interfaces:**
- Consumes `requireRole("campaign.view")`, `ctx.db`, `can`, all Task 4/5 actions, `PlaylistPreviewDialog` (with `fetchPath`), the dialog/select/input/checkbox/button primitives, `sonner`, `useRouter`, `date-fns`.
- Produces:
  - `[id]/page.tsx` (server): `const { id } = await params` (params is a Promise); `notFound()` when the campaign is not in the org. One `withOrgTransaction`: the campaign (all scalars + `playlist: { id, name, archivedAt }`), its `CampaignScreen.screenId[]` and `CampaignLocation.locationId[]`, the org's non-archived playlists (`id, name`), the org's screens (`id, name, locationId, location: { name }`), the org's locations (`id, name`). Compute `affectedScreenCount` server-side = size of the union of the directly-targeted screen ids and every screen whose `locationId` is in the targeted location set. Pass campaign datetimes as ISO strings and a precomputed `isArchived` boolean; NO `Date` objects. `canUpdate` / `canDelete` via `can(ctx.actor, ...)`.
  - `campaign-editor.tsx` (`"use client"`): a fields form -- name `<Input maxLength={120}>`, description `<Textarea maxLength={500}>`, playlist `<Select>`, start + end `<input type="datetime-local">` (seed from the ISO strings via `toDatetimeLocal(iso)`; on Save convert back with `new Date(local).toISOString()`), priority `<Input type="number" min={0} max={1000}>`, an enable `<Checkbox>` (calls `setCampaignEnabled` immediately). A single "Save" button calls `updateCampaign(id, patch)` with only the changed fields; `{ error }` -> inline alert + `toast.error`; success -> `toast.success` + `router.refresh()`. A "Preview" button opens `<PlaylistPreviewDialog open playlistId={campaign.playlist.id} playlistName={campaign.playlist.name} fetchPath={\`/api/campaigns/${id}/preview\`} />`. A line "This campaign currently affects N screens" from `affectedScreenCount`. When `campaign.playlist.archived`, a warning line. A delete control (confirm `Dialog` -> `deleteCampaign(id)` -> `router.push("/campaigns")`) when `canDelete`. An "archived" banner when `isArchived`, with a Restore button (`restoreCampaign`). All inputs `disabled` when `!canUpdate`.
  - `campaign-targets-panel.tsx` (`"use client"`): props `campaignId`, `screens: { id, name, locationId, locationName }[]`, `locations: { id, name }[]`, `targetedScreenIds: string[]`, `targetedLocationIds: string[]`, `canUpdate`. Render each location as a row with a `<Checkbox>` (whole-location target) and its screens nested, each with a `<Checkbox>`. A screen whose `locationId` is in `targetedLocationIds` renders checked + disabled with a "via location" hint (it is covered regardless of its own box). Toggling anything computes the next `{ screenIds, locationIds }` (screenIds = individually checked screens NOT covered by a checked location; locationIds = checked locations) and calls `setCampaignTargets(campaignId, next)` then `router.refresh()`. `{ error }` -> `toast.error`. Whole panel disabled when `!canUpdate`. If `screenIds` and `locationIds` would both be empty, the panel still calls the action and shows the returned `{ error }` from `setTargetsSchema` as a toast (do not block client-side; keep the single validation source).

- [ ] **Step 1: `campaign-editor.test.tsx` (jsdom, write, run, fail)** -- mock the actions module, `sonner`, `next/navigation`, and `fetch` (for the preview dialog). Add the jsdom shims from `playlist-editor.test.tsx`. Render `CampaignEditor` with a campaign, 2 screens across 2 locations, one screen pre-targeted. Assert: the name/priority inputs seed from props; toggling the enable checkbox calls `setCampaignEnabled(id, false)`; clicking Save after editing the name calls `updateCampaign(id, { name: <new> })`; the "affects N screens" line shows the passed count; the delete control is absent when `canDelete={false}`; checking a location's box in the targets panel calls `setCampaignTargets` with that `locationId` in `locationIds`.

- [ ] **Step 2: implement** the page + two components. Watch the RSC boundary (page passes only serializable props). Run the component test -- PASS.

- [ ] **Step 3:** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` green. `npm run dev` + `npm run storage:up` -- create a campaign, set its window active now, target a location, open Preview, toggle enable, Save a field change, delete.

- [ ] **Step 4: commit** -- `git add "src/app/(app)/campaigns/[id]/page.tsx" src/components/app/campaigns && git commit -m "feat: campaign editor page and targets panel"`

---

## Task 11: Cross-tenant isolation tests

**Files:** Modify `src/test/isolation/tenant-isolation.spec.ts`.

**Interfaces:** Consumes the campaign actions, `forOrg`, `withOrgTransaction`, the existing org-A / org-B fixture.

- [ ] **Step 1: extend the fixture** -- `setup()` also creates, in org B: a `Playlist`, a `Campaign` on it (valid window), a `CampaignScreen` for B's screen, and a `CampaignLocation` for B's location. Return `bCampaignId`, `bCampaignScreenId`, `bCampaignLocationId` (reuse B's existing `bScreenId` / a B location).

- [ ] **Step 2: add cases** (org A context, B ids; lazy `await import("@/app/(app)/campaigns/actions")`; capture `before` via raw `prisma`, assert error/throw + `expect(after).toEqual(before)`):
  - `forOrg(A).campaign.findMany()` / `.campaignScreen.findMany()` / `.campaignLocation.findMany()` contain none of B's ids; `forOrg(A).campaign.findUnique({ where: { id: bCampaignId } })` is `null`. Control: `forOrg(B).campaign.findMany()` returns `[bCampaignId]`.
  - `updateCampaign(bCampaignId, { priority: 99 })`, `setCampaignEnabled(bCampaignId, false)`, `archiveCampaign(bCampaignId)`, `deleteCampaign(bCampaignId)` (assert the row survives), `setCampaignTargets(bCampaignId, { screenIds: [f.bScreenId], locationIds: [] })` -- each `{ error }` / throw, B rows unchanged, B campaign count unchanged.
  - `createCampaign` in an A context but with a **B** `playlistId` -> `{ error }`, no row.
  - `setCampaignTargets` on an A campaign with a **B** `screenId` -> `{ error }`, no join rows.
  - `withOrgTransaction(A.id, tx => tx.$queryRawUnsafe('SELECT id FROM "Campaign"'))` returns none of B's ids; same for `"CampaignScreen"`, `"CampaignLocation"`.

- [ ] **Step 3: run** `npm run test -- src/test/isolation/tenant-isolation.spec.ts` -- PASS. Full suite green.

- [ ] **Step 4: commit** -- `git add src/test/isolation/tenant-isolation.spec.ts && git commit -m "test: tenant isolation for campaigns"`

---

## Task 12: e2e, docs, demo script

**Files:** Create `src/test/e2e/campaigns.spec.ts`; modify `docs/architecture.md`; create `scripts/simulate-campaigns.ts`.

**Interfaces:** Consumes the built app + local Postgres (`lynesign_test`) + MinIO.

- [ ] **Step 1: `src/test/e2e/campaigns.spec.ts`** -- `beforeAll` `resetDb()` + `seedPlans()`. One `test`, `test.setTimeout(90_000)`:
  - register a fresh user + org (copy the register block from `campaigns`... use `src/test/e2e/media.spec.ts` as the reference).
  - seed via `@/lib/db/root` `prisma`: a `Location`, a `Screen` in it (`status: "UNPAIRED"`, known `pairingCode`), a base `Playlist` with one READY image (real MinIO object via `assetStorageKey` + `storage.putObject`; name "Base"), and a second `Playlist` with one READY image (name "Campaign").
  - `page.goto("/campaigns")`, "New campaign", fill name "Live Now", pick the "Campaign" playlist, set start = 1 hour ago and end = 1 day from now (compute and format as `datetime-local`), submit, land on `/campaigns/<id>`.
  - in the targets panel, check the location (or the screen).
  - `request.post("/api/player/pair", { data: { pairingCode } })` -> device token.
  - `request.get("/api/player/sync", { headers: { Authorization: \`Bearer ${token}\` } })` -> assert `body.source === "campaign"`, `body.campaign.name === "Live Now"`, `body.playlist` is the "Campaign" playlist manifest (1 item), no `canvas` key.
  - edit the campaign: set the end datetime to 2 hours ago, Save.
  - `request.get("/api/player/sync", ...)` again -> assert `body.source === "playlist"` (the base playlist) and `body.playlist.name === "Base"`.

- [ ] **Step 2: docs** -- `docs/architecture.md`: add a `## Campaigns` section after `## Playlists` (the three models, `resolveScreenContent`'s rule incl. the half-open window and the priority/endsAt/id tie-break, the sync `source` / `campaign` payload fields, the `deletePlaylist` guard, the one-poll-latency limitation). Update the roadmap list to mark campaigns done and renumber. Grep every symbol/path cited (`resolveScreenContent`, `bumpCampaignRevision`, `Campaign`, `CampaignScreen`, `CampaignLocation`, `setCampaignTargets`, `src/lib/player/campaign.ts`) to confirm it exists.

- [ ] **Step 3: `scripts/simulate-campaigns.ts`** -- match the `simulate-*.ts` family (doc comment, `main()`, re-run safe with `--force`, `prisma` + `withOrgTransaction`, `console.table` summary, `.then(process.exit(0)).catch(...)`). For "Costa Signage Co": require an existing `Playlist` (throw if none). Create "Fall Sale" -- points at an existing playlist, `startsAt` = yesterday, `endsAt` = 3 weeks out, `priority: 10`, targeting one `Location` via `CampaignLocation`. Create "Holiday Preview" -- another playlist, `startsAt` = next week, `endsAt` = 5 weeks out, `priority: 5`, targeting 2 screens via `CampaignScreen`. Write the join rows directly (seed script, not the gated action). `console.table` `{ campaigns, screenTargets, locationTargets }`. Run it once against the dev DB (`npm run db:up` first) and paste the summary into the report. Excluded from typecheck by the `scripts/simulate-*.ts` glob.

- [ ] **Step 4:** `npm run storage:up && npm run test:e2e -- campaigns.spec.ts` -- passes; then `npm run test:e2e` (all specs) green. If `next build` is blocked in the main checkout by a concurrent session's `tsconfig.json`, run e2e from a throwaway worktree at your commit and document it. Full `npm run test`, `npm run lint`, `npm run typecheck` green.

- [ ] **Step 5: commit** -- `git add src/test/e2e/campaigns.spec.ts docs/architecture.md scripts/simulate-campaigns.ts && git commit -m "test: end-to-end campaign journey; docs and demo script"`

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 2 In scope 1 (models, migration, RLS, list sync -> 30) | 1 |
| 2 In scope 2 (`campaign.*` RBAC, nav gate) | 2 |
| 2 In scope 3 (validation module) | 1 |
| 2 In scope 4 (`bumpCampaignRevision`, `resolveScreenContent`) | 3, 4 |
| 2 In scope 5 (CRUD + `setCampaignTargets`) | 4, 5 |
| 2 In scope 6 (sync resolves campaign, `source`/`campaign`) | 7 |
| 2 In scope 7 (`deletePlaylist` guard) | 6 |
| 2 In scope 8 (list + editor, reuse preview) | 8, 9, 10 |
| 2 In scope 9 (tests) | every task + 11 (isolation) + 12 (e2e) |
| 2 In scope 10 (docs, demo script) | 12 |
| 3.1 revision + `bumpCampaignRevision` single writer; archive/restore/delete no bump | 4 (helper + callers), 5 |
| 3.2 `resolveScreenContent` rules | 3 |
| 3.3 no new deps (`datetime-local`) | 9, 10 |
| 4.1 `Campaign` model | 1 |
| 4.2 `CampaignScreen` | 1 |
| 4.3 `CampaignLocation` | 1 |
| 4.4 RLS + facade + triplicated list | 1 |
| 5 zod schemas | 1 |
| 6 server actions table | 4, 5 |
| 6 `GET /api/player/sync` changes | 7 |
| 6 `GET /api/campaigns/[id]/preview` | 8 |
| 7 RBAC table + nav | 2 |
| 8 `deletePlaylist` guard | 6 |
| 9.1 list page | 9 |
| 9.2 editor + targets panel + preview-dialog `fetchPath` | 8 (prop), 10 (page + components) |
| 10 unit / integration / isolation / e2e | 3, 1, 4, 5, 7, 8 / 11 / 12 |
| 10 documented limitation (poll latency) | 12 (docs) |
| 11 deliverables | all |
| 12 risks | acknowledged; no task needed |

**Placeholder scan** -- no `TBD` / `TODO` / "add validation" / "handle errors" / "similar to Task N". Every action has an explicit signature, role, and behavior. The migration RLS block is given in full. Every zod schema is given in full. `resolveScreenContent`'s signature and every rule are enumerated in the spec and its test cases are listed. Task 8's "extract a shared helper or duplicate and note it" is a bounded decision, not a gap.

**Type consistency** -- `bumpCampaignRevision(tx, campaignId)` fixed in Task 4, used in 4 and 5. `resolveScreenContent`'s `campaigns[]` element shape (Task 3) is exactly what Task 7 maps its query rows into; `ScreenContent`'s fields (`source`, `campaignId`, `campaignName`, `campaignRevision`, `campaignEndsAt`, `playlistId`) are exactly what Task 7 spreads into the payload's `campaign` object (`id`, `name`, `revision`, `endsAt`). `campaign.*` action strings identical across Tasks 2, 4, 5, 7 (preview uses `campaign.view`), 9, 10. `Campaign.revision` is `Int @default(1)`, only ever `{ increment: 1 }`. Half-open window (`startsAt <= now < endsAt`) is stated identically in the spec, Task 3 tests, and Task 7's `findMany` (`startsAt: { lte: now }, endsAt: { gt: now }`). `TENANT_MODELS` / `TENANT_TABLES` / RLS `ARRAY` all reach 30 in Task 1 and `tenant-model-list.test.ts` enforces it. `PlaylistPreviewDialog`'s new `fetchPath?` prop (Task 8) is consumed by the campaign editor (Task 10) with the default preserved for the playlist editor.
