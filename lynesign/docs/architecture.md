# LyneSign architecture

This document describes the LyneSign Foundation build: a multi-tenant digital-signage
SaaS that carries the Display Monkey domain model onto a modern stack. It covers the
runtime shape, the data model, authentication, authorization, multi-tenancy, environment
variables, deployment, the decisions taken during the build, and the migration path from
Display Monkey.

## Overview

LyneSign is a single Next.js application plus one background worker, both talking to one
PostgreSQL database.

- **Web app.** Next.js 16 (App Router, React 19, TypeScript strict). Server Components and
  route handlers run on the Node runtime. There is no `middleware.ts` and there are no
  edge routes, because the database layer depends on `pg`, which is Node only.
- **Worker.** A long-lived `tsx` process (`src/worker/index.ts`) that runs several periodic
  jobs: `sweepOfflineScreens` every 60 seconds, `sendInvitationEmails` every 30 seconds,
  and the three media jobs (`processMediaAsset`, `sweepStuckUploads`, `purgeArchivedMedia`;
  see Media). It shares the same source tree and Prisma client but no HTTP surface.
- **Database.** PostgreSQL. Prisma 6 is the ORM, wired through `@prisma/adapter-pg` over a
  `pg.Pool` the app owns (`src/lib/db/root.ts`), because connection checkout is on the hot
  path for tenant isolation (see Multi-tenancy).
- **Auth.** Auth.js (next-auth) v5 with database sessions and the Prisma adapter.
- **UI.** Tailwind CSS v4 and shadcn/ui primitives, with an app-specific component layer
  in `src/components/app`.

Directory layout:

| Path | Contents |
| --- | --- |
| `src/app/(auth)` | sign-up, sign-in, sign-out, forgot / reset password, invitation accept |
| `src/app/(app)` | dashboard, locations, screens, users, settings, billing, and five ComingSoon sections |
| `src/app/api/player` | `pair`, `sync`, `heartbeat` for the player device protocol |
| `src/app/api/health` | liveness probe |
| `src/lib/db` | `root.ts` (unscoped client), `tenant.ts` (the tenant facade) |
| `src/lib/auth` | Auth.js config, session helpers, password hashing, request context |
| `src/lib/rbac` | roles, the policy table, `can` / `assertCan` |
| `src/lib/plan-limits` | subscription plan quota checks |
| `src/lib/errors`, `src/lib/logging`, `src/lib/audit` | typed errors, pino logger, audit-log writer |
| `src/worker` | worker entry point and jobs |
| `scripts` | `dev-db.mjs`, `ensure-test-db.mjs`, `migrate-displaymonkey.ts`, `generate-encryption-key.ts`, `dm/` mappers |
| `prisma` | `schema.prisma`, five migrations, `seed.ts` |

## Data model

The schema is [`prisma/schema.prisma`](../prisma/schema.prisma). Every tenant-scoped table
carries a denormalized `organizationId` column so that a single row-level-security policy
can guard all of them. Rows that survive a Display Monkey import also carry a `legacyId`
unique column.

**Identity and tenancy.** `User`, `Organization`, `Membership` (join table with a `Role`
and a `MembershipStatus`), `Invitation` (email, role, token, expiry). `Account`, `Session`
and `VerificationToken` are the Auth.js adapter tables. `Session` rows are written both by
the adapter and directly by credential login.

**Hierarchy.** `Location` is a self-referential tree (`parentId`) that also holds address,
geo, time zone and locale. `Screen` belongs to a `Location`, optionally references a
`Canvas`, and holds pairing state (`pairingCode`, `deviceTokenHash`, `status`,
`lastSeenAt`).

**Content skeleton (carried from Display Monkey).** `Canvas` has many `Panel`, each `Panel`
has many `Frame`, each `Frame` has one `Content`. `FrameLocation` scopes a frame to
specific locations. `Content` fans out to one of eleven typed detail tables: `Clock`,
`Picture`, `Video`, `Youtube`, `Html`, `Memo`, `Outlook`, `Report`, `Powerbi`, `Weather`,
`News`. The `FrameType` enum names the same eleven kinds. This structure is intentionally
close to the Display Monkey original so the migration is a shape-preserving copy; the
Foundation build does not yet render or edit it.

**Billing.** `Plan` (keyed by the `PlanKey` enum: `TRIAL`, `STARTER`, `GROWTH`,
`ENTERPRISE`) holds nullable quota columns (`maxScreens`, `maxStorageBytes`, `maxUsers`,
`maxLocations`) and a `features` JSON blob. `Subscription` links an `Organization` to a
`Plan` with a `SubscriptionStatus` and trial / Stripe fields. Sign-up creates a `TRIAL`
subscription. Billing is read-only in this build.

**Cross-cutting.** `AuditLog` records actor (user, screen or system), action, target and
metadata; its `organizationId` is nullable so platform-level events can be recorded.
`OutboundEmail` is a global retry queue for the worker's mailer, deliberately not
tenant-scoped and deliberately absent from the RLS policy list. `LegacyIntegration` stores
Display Monkey integration accounts as opaque payloads for a later increment.

## Authentication

Auth.js v5 with `@auth/prisma-adapter` and `session: { strategy: "database" }`. There is
no JWT session anywhere.

- **Credential login.** Email plus a bcrypt hash (cost 12, `bcryptjs`). It does not use a
  NextAuth `CredentialsProvider`, because that provider forces JWT sessions. Instead
  `src/lib/auth/session.ts#createCredentialsSession` writes a `Session` row directly, in
  the exact shape the Prisma adapter writes for any other sign-in, so `auth()` resolves
  both identically.
- **Cookie derivation.** `sessionCookieOptions` and `SESSION_COOKIE` derive the cookie
  name and the `secure` flag from the scheme of `AUTH_URL`, not from `NODE_ENV`. Auth.js
  itself keys `useSecureCookies` off `AUTH_URL`, so a credential login has to use the same
  signal, or a production build served over HTTP would write
  `__Secure-authjs.session-token` while `auth()` reads `authjs.session-token` and every
  request looks signed out. Real production sets `AUTH_URL=https://...`.
- **Sign-up.** One transaction creates the `User`, the `Organization`, an `OWNER`
  `Membership` and a `TRIAL` `Subscription`.
- **Invitations.** An `OWNER` or `ADMIN` mints an `Invitation` (token, role, expiry). The
  invite email is enqueued into `OutboundEmail` and sent by the worker. Accepting links or
  creates the `User` and adds a `Membership` with the invitation's role.
- **Password reset.** Forgot / reset issues a single-use token, and a successful reset
  deletes every `Session` for that user.

## Authorization

One module, `src/lib/rbac`, is the single gate.

- **Roles.** `OWNER`, `ADMIN`, `MANAGER`, `CONTENT_MANAGER`, `VIEWER`, ranked by
  `ROLE_RANK`. `User.isSuperAdmin` is a separate platform-operator flag, not a role.
- **The policy table.** `src/lib/rbac/policy.ts` is a plain `Record<Action, Role[]>` map
  covering twenty actions across org, member, location, screen, billing, audit and player
  domains. It is reviewable in one place and unit-tested exhaustively.
- **`can(actor, action)` / `assertCan(...)`.** The `Actor` is a discriminated union. A
  `user` actor is allowed if `isSuperAdmin`, otherwise if its role appears in
  `POLICY[action]`. A `screen` actor (the non-human `SCREEN` principal, authenticated by
  device token rather than a session) is allowed only the `player.sync` action.
- **Server is the gate.** Server actions and route handlers call `assertCan` before any
  mutation and throw a typed `ForbiddenError`. The UI uses the same table to hide
  controls, but never as the enforcement point.

Request context lives in `src/lib/auth/context.ts`: `requireUser`, `requireOrg` and
`requireRole` resolve the session, validate the active `organizationId` against the user's
`Membership` rows (a client-supplied org id is never trusted), and return
`{ user, organizationId, role, db, actor }` where `db` is the tenant-scoped client.

## Multi-tenancy

Single database, single schema, `organizationId` on every tenant table. Two independent
layers guard every tenant read and write, and both apply to everything the tenant facade
exposes.

### Layer 1: application scoping (Prisma `$extends`)

`src/lib/db/tenant.ts` builds a Prisma Client query extension bound to one organization.
For each of the 25 tenant-scoped models (`TENANT_MODELS`) it rewrites every operation:

- `organizationId` is merged into `where` for reads, updates and deletes.
- `organizationId` is injected into `data` for `create` / `createMany` / `upsert`.
- A caller-supplied value naming a different organization is rejected with
  `CrossTenantError`, never silently rewritten.
- An operation the guard does not recognize throws rather than running unscoped. This is
  the spec's "fails closed" requirement.

Layer 1 only sees the top level of an operation's arguments. A nested write
(`data: { panels: { create: [...] } }`), a raw foreign key pointing at another org's row,
and `connect: { id }` all slip past it. Layer 2 is what stops those.

### Layer 2: Postgres row-level security

Migrations `20260830025904_rls` and `20260830032500_rls_empty_guc_is_unscoped` put
`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on the original 23 tenant
tables, each with the same policy (`20260830183100_media_library` adds the same two
lines for `MediaFolder` and `MediaAsset`, bringing it to 25):

```sql
CREATE POLICY tenant_isolation ON <table>
USING (
  coalesce(current_setting('app.current_org', true), '') = ''
  OR "organizationId" = current_setting('app.current_org', true)
)
WITH CHECK (
  coalesce(current_setting('app.current_org', true), '') = ''
  OR "organizationId" = current_setting('app.current_org', true)
);
```

The GUC `app.current_org` is set transaction-locally with
`SELECT set_config('app.current_org', $1, true)` at the start of every tenant transaction.

**The empty-string fix.** A custom GUC placeholder reads as `NULL` only until the session
first touches it. After `SET LOCAL app.current_org = ...` commits, Postgres does not
restore `NULL`, it restores the reset value, which is the empty string, and that is
permanent for the life of the backend (`RESET`, `set_config(..., NULL, false)` and
`DISCARD ALL` all leave it as `''`). The first policy shipped tested `IS NULL`, so every
pooled connection that had ever carried tenant scope went permanently blind: `''` is not
`NULL` and matches no `organizationId`, so the policy hid every row from the unscoped root
client that later reused that connection. The second migration folds `''` into the
"no context" branch. It is not optional; Layer 2 is unusable without it.

**Why a non-superuser role.** A Postgres superuser bypasses row-level security even under
`FORCE ROW LEVEL SECURITY`. The application, the worker, and every test suite connect as
`lynesign_app`, a `LOGIN NOSUPERUSER` role. Locally `scripts/dev-db.mjs` creates it and
makes it own the database; in CI `.github/workflows/ci.yml` creates it against the service
container; in production the deployment provisions it. If the app connected as a
superuser, the RLS layer and the tenant-isolation test suite would silently pass without
testing anything.

### The two entry points

- **`forOrg(orgId)`** returns a Prisma-shaped facade over just the 25 tenant models. It is
  an allow-list, not a cast: `$queryRawUnsafe`, `$transaction`, `$extends` and every
  non-tenant delegate (`organization`, `user`, `plan`) are unreachable and throw if asked
  for. Each call runs as its own `withOrgTransaction`, so both layers apply.
- **`withOrgTransaction(orgId, fn)`** runs `fn` in one transaction with Layer 1 applied and
  the RLS GUC set, and hands `fn` a client that also exposes raw SQL (safe there precisely
  because RLS is active on that connection). Use it for multi-step units of work and for
  raw SQL.

`withOrgTransaction` takes optional Prisma interactive-transaction options
(`{ timeout, maxWait }`) as a third argument. Omitted, Prisma's defaults apply (5s / 2s);
the Display Monkey import raises `timeout` to 120s for its bulk insert.

**Known cost (tech debt).** Because `forOrg` composes on `withOrgTransaction`, every single
operation through it checks out a pooled connection and opens a transaction. This was an
explicit orchestrator decision (ledger Ruling R8): tenant-isolation correctness outweighs
the per-operation overhead for the Foundation build, and it is the only arrangement under
which the "fails closed" contract is actually true. A hot-path raw-read optimization is a
separate, reviewed future change. Where a page issues several org-scoped reads it should
open one `withOrgTransaction` instead of several `forOrg` calls: `getDashboardData` does
exactly that, so a dashboard load costs one connection rather than four.

### The unscoped client

`src/lib/db/root.ts` exports the raw `prisma` client. Nothing about it is tenant-scoped:
neither the argument guard nor the RLS GUC applies to a query issued through it.

It is not confined to a directory. It is confined to an **enumerated set of call sites**,
each of which either carries an explicit `organizationId` produced by a validated
`requireOrg()` / `requireRole()`, touches a global (non-tenant) table (`User`, `Session`,
`Organization`, `Plan`, `OutboundEmail`, `VerificationToken`), or is legitimately
cross-organization. The sanctioned importers, with a reason each, are listed in the doc
comment at the top of `src/lib/db/root.ts`; in summary they are the Auth.js adapter and
session code, `lib/auth/context.ts` (the bootstrap membership lookup that decides the
scope), `lib/plan-limits`, `lib/audit` (its unscoped fallback), `lib/email`, `lib/slug`,
the `(auth)` server actions, the device-token player auth and routes, the health probe,
the `(app)` layout / settings / billing / users call sites that pass a validated
`ctx.organizationId`, the worker jobs, and `scripts/` plus `prisma/` tooling and tests.

That list is **mechanically enforced**. `eslint.config.mjs` restricts every import of
`@/lib/db/root` (and its relative spellings) and re-allows it file by file from
`RAW_PRISMA_ALLOWED`, so a new importer fails `npm run lint` in CI. Adding a file to that
array is a deliberate act and must come with the same reasoning, recorded in the
`src/lib/db/root.ts` comment.

## Media

The Media subsystem (increment 3) adds upload, object storage, and the asset pipeline
behind `Picture` and `Video`. It is the first part of the app that talks to something other
than Postgres: an S3-compatible object store.

### Data model

Three models, added in migration `20260830183100_media_library`:

- **`MediaFolder`** is a self-referential tree (`parentId`, `onDelete: Cascade`), tenant-scoped.
  `@@unique([organizationId, parentId, name])` keeps sibling names distinct; because Postgres
  treats `NULL` as distinct that constraint misses root folders, so a partial unique index
  (`MediaFolder_organizationId_name_root_key`, migration `20260830190000_media_folder_root_unique`)
  covers `parentId IS NULL`.
- **`MediaAsset`** is one uploaded file or one registered web page. `kind` is `IMAGE | VIDEO |
  WEB`; `status` is `UPLOADING | READY | FAILED`. It carries `storageKey`, `thumbnailKey`,
  `checksum` (SHA-256), `sizeBytes` (BigInt), `width` / `height` / `durationSeconds`, `tags`,
  a nullable `createdByUserId`, and a nullable `archivedAt` for soft-delete. A `WEB` asset
  stores only `url` and has no object.
- **`MediaProcessingJob`** is the video post-processing queue. It is **global**: no
  `organizationId`, no RLS, one row per asset (`mediaAssetId @unique`), `status`
  `PENDING | DONE | FAILED` with an `attempts` counter. It is reached through the unscoped
  root client and drained by the worker, exactly like `OutboundEmail`.

`MediaFolder` and `MediaAsset` join `TENANT_MODELS` (now 25) and get the standard `ENABLE`
+ `FORCE ROW LEVEL SECURITY` `tenant_isolation` policy in the same migration;
`MediaProcessingJob` is deliberately left out of the policy list. `Picture.mediaAssetId` and
`Video.mediaAssetId` are nullable back-links from the content skeleton to an asset
(`onDelete: SetNull`), so a purge never breaks a frame.

### Storage provider

`src/lib/storage/` defines a narrow `StorageProvider` interface (`createUploadUrl`,
`createDownloadUrl`, `putObject`, `getObjectStream`, `headObject`, `deleteObject`,
`deletePrefix`) and one implementation, `S3StorageProvider` (`s3.ts`), built on
`@aws-sdk/client-s3`. It runs against AWS S3 in production and a local MinIO endpoint
everywhere else; setting `STORAGE_ENDPOINT` also flips the client to path-style addressing,
which MinIO requires. The module memoises the provider on `globalThis` in dev, mirroring
`src/lib/db/root.ts`.

Object keys are always derived server-side, never taken from client input:

- `assetStorageKey(orgId, assetId, ext)` -> `org/<orgId>/<assetId>/original<ext>`
- `assetThumbKey(orgId, assetId)` -> `org/<orgId>/<assetId>/thumb.webp`

The `org/<orgId>/<assetId>/` prefix is what `deletePrefix` sweeps when an asset is failed or
purged.

### Direct-upload flow

Uploads go straight from the browser to the object store; the app never proxies the bytes.

1. **`requestUpload({ folderId?, filename, mimeType, sizeBytes })`** is gated by
   `requireRole("media.create")`. `classifyKind` maps the MIME type to a `kind` or rejects
   it; `sizeBytes` is the client's declared size, checked against the per-kind ceiling
   (`MEDIA_MAX_BYTES`) only to fail fast; `assertCanAddStorage` checks the plan's storage
   limit (its `PlanLimitError` is returned as `{ error }`, never thrown). It creates the
   `MediaAsset` row `UPLOADING`, derives and stores the `storageKey`, and returns a 300s
   presigned `PUT` target (`UploadTarget`).
2. **The browser `PUT`s the bytes** to that URL with the `Content-Type` header. A SigV4
   presigned PUT cannot pin a size range, so the ceiling is not enforced at the edge; step 3
   does it.
3. **`finalizeUpload(assetId)`** is gated by `requireRole("media.create")`. The row must
   still be `UPLOADING`. `headObject` must return an object whose size equals the row's
   `sizeBytes` and whose content type (when the store reports one) equals the row's
   `mimeType`; a size or content-type mismatch deletes the object and flips the row to
   `FAILED`, a missing object just fails it. On success the bytes are streamed once through a
   SHA-256 hash for `checksum`; an image also feeds a `sharp` pipeline for `width` / `height`
   and a 480px webp thumbnail stored under `thumbnailKey`, while a video enqueues a
   `MediaProcessingJob`. A prior non-archived `READY` asset in the org with the same checksum
   is reported as `duplicateOf`; the upload still completes.

`GET /api/media/[id]/url` returns a one-hour presigned GET for the original (plus one for
the thumbnail when present) for library previews; a `WEB` asset returns its stored `url`
verbatim. The lookup is through the tenant facade, so an id outside the caller's active
organization reads as absent.

### Authorization

Five policy rows in `src/lib/rbac/policy.ts`:

| Action | Roles |
| --- | --- |
| `media.view` | all roles |
| `media.create` | `CONTENT_MANAGER` and up |
| `media.update` | `CONTENT_MANAGER` and up |
| `media.folder.manage` | `CONTENT_MANAGER` and up |
| `media.delete` | `MANAGER` and up |

`deleteAssets` is a soft-delete that stamps `archivedAt`; `restoreAsset` (gated
`media.update`) clears it after re-checking that the stored object still exists.

### Plan limits

`getStorageUsage(orgId)` is now a real aggregate: `SUM(sizeBytes)` over every non-archived
`MediaAsset` that is `READY` or `UPLOADING`, compared against the plan's `maxStorageBytes`.
`assertCanAddStorage(orgId, addBytes)` gates every upload; a null limit (`ENTERPRISE`) is
unlimited.

### Worker jobs

Three periodic jobs in `src/worker/`, all running unscoped through the root client:

- **`processMediaAsset`** (every 20s) drains a batch of `MediaProcessingJob`. Per video:
  presigned GET, `ffprobe` for `durationSeconds` and dimensions, `ffmpeg` + `sharp` for a
  480px webp poster under the thumbnail key. The toolchain is optional: a missing `ffprobe`
  / `ffmpeg` (`ENOENT`) parks the job `DONE` with no duration and no thumbnail, and the card
  falls back to a glyph. A real error bumps `attempts` and retries up to five times, then
  parks the job `FAILED`.
- **`sweepStuckUploads`** (every 5m): a row left `UPLOADING` for more than an hour is
  abandoned, so its object prefix is deleted and the row flipped to `FAILED`, with one
  aggregate `SYSTEM` audit row per org.
- **`purgeArchivedMedia`** (every 15m): an asset archived more than 7 days ago and
  referenced by no `Picture` or `Video` row is hard-deleted, objects first, then the row. A
  still-referenced asset is left for a later run.

### Deferred: CDN delivery

`STORAGE_PUBLIC_URL` is a hook for a later increment and is unset today. When set, public
asset URLs would be served from a CDN in front of the bucket instead of the presigned GETs
the library uses now; player delivery (increment 4) is what needs it.

### Local storage harness

Local development and tests get their S3 endpoint from a MinIO server binary downloaded on
first use and run as a detached subprocess on `:9000` (no Docker, mirroring the
`embedded-postgres` arrangement for the database). `scripts/dev-storage.mjs` (`npm run
storage:up` / `npm run storage:down`) downloads the binary into `.minio/`, health-checks it,
and ensures the `lynesign-media` bucket. `.github/workflows/ci.yml` runs the same `npm run
storage:up` step before the unit and e2e suites.

## Playlists

The Playlists subsystem (increment 4) is the first authoring surface for what a screen
actually plays: a named, ordered list of `MediaAsset` rows, assembled into a player manifest
on demand at sync time. It reuses the Media object store and adds no new infrastructure.

### Data model

Two models, added in migration `20260831055827_playlists`:

- **`Playlist`** is a named, ordered list, tenant-scoped and soft-deleted via `archivedAt`.
  It carries `defaultImageDurationSeconds` (10) and `defaultWebDurationSeconds` (30) for
  items that set no override, a monotonic `revision` (see below), and a nullable
  `createdByUserId` (`onDelete: SetNull`).
- **`PlaylistItem`** is one entry. The same asset may appear more than once, so there is no
  uniqueness on `[playlistId, mediaAssetId]`. `position` is a 0-based contiguous integer
  with no unique constraint either; `durationSeconds` null means "fall back to the playlist
  default for the kind", and `enabled` false keeps a row without playing it. `mediaAssetId`
  is `onDelete: Restrict`, so a purge cannot remove an asset a playlist still references.
- **`Screen.playlistId`** is a new nullable column (`onDelete: SetNull`), so deleting a
  playlist drops every screen back to no playlist rather than cascading. `Screen.canvasId`
  is still present, but sync prefers `playlistId`.

`Playlist` and `PlaylistItem` join `TENANT_MODELS` (now 27) and both get the standard
`ENABLE` + `FORCE ROW LEVEL SECURITY` `tenant_isolation` policy in the same migration;
`Screen` already had its policy from an earlier migration. `TENANT_MODELS` in `tenant.ts` now
lists 27 entries; `src/lib/db/tenant-model-list.test.ts` holds it, the union of the RLS
migration `ARRAY` blocks, and `TENANT_TABLES` in the isolation suite to the same set.

### The revision contract

`Playlist.revision` is a monotonic `Int` that starts at 1 and is only ever incremented,
never set to an absolute value. `bumpRevision(tx, playlistId)`
(`src/lib/playlists/revision.ts`) does the increment inside the same `withOrgTransaction`
that made the change, so the write and the bump commit together. A device caches the last
`revision` it saw and refetches the manifest when it climbs.

What bumps it: item add, remove, reorder, per-item duration, per-item enable or disable, and
any `updatePlaylist` call (rename, description, or default-duration change) bumps `revision`.
What does not:
`createPlaylist` (the row is born at 1), `deletePlaylist`, `archivePlaylist` and
`restorePlaylist` (assembly still reads an archived playlist and a screen keeps playing it
until it is reassigned, so archiving changes no manifest content), and
`assignPlaylistToScreen` (screen membership is not part of any playlist's manifest).

### Position

`PlaylistItem.position` is a dense `0..n-1` range. With no unique constraint on
`[playlistId, position]`, every mutation rewrites the whole permutation in one
`withOrgTransaction`: `addItems` appends at `count..count+k-1`, `removeItem` decrements every
later row, and `reorderItems` writes the final `0..n-1` straight through in one pass with no
offset dance. `src/app/(app)/playlists/playlists.test.ts` asserts the range stays a clean
`0..n-1` permutation after each kind of edit and through a full mixed sequence.

### On-demand manifest assembly

`GET /api/player/sync` builds the manifest fresh on every poll; nothing is stored. The route
resolves the screen from its bearer token, and when `screen.playlistId` is set it loads the
playlist, its `enabled` items in `position` order, and the referenced assets, then hands them
to the pure `assembleManifest` in `src/lib/player/manifest.ts`. Assembly drops any item
whose asset is missing, archived (`archivedAt` set), or not `READY`, and resolves the rest:

- **URL.** IMAGE and VIDEO get a presigned GET against the object store, TTL 3600s; WEB
  returns its stored `url` verbatim. An IMAGE or VIDEO with no `storageKey` is dropped.
- **Duration.** The item override when set, else the playlist default for IMAGE and WEB,
  else `asset.durationSeconds ?? 0` for VIDEO (0 meaning "play to natural end").

The payload is:

```
{
  screenId,
  pollIntervalSeconds,
  playlist: {
    id, name, revision,
    items: [{ id, kind, url, durationSeconds, mimeType, width, height }]
  } | null
}
```

`playlist` is null when the screen has no playlist assigned or its playlist row is gone. The
stub `canvas` and top-level `manifest` keys the earlier build returned are gone.

### Authorization

Five policy rows in `src/lib/rbac/policy.ts`:

| Action | Roles |
| --- | --- |
| `playlist.view` | all roles |
| `playlist.create` | `CONTENT_MANAGER` and up |
| `playlist.update` | `CONTENT_MANAGER` and up |
| `playlist.delete` | `MANAGER` and up |
| `playlist.assign` | `MANAGER` and up |

The sidebar's Playlists link (`src/lib/nav.ts`) is gated on `playlist.view`.

### Interaction with the purge worker

`purgeArchivedMedia` now counts `PlaylistItem` rows alongside `Picture` and `Video` before
hard-deleting an archived asset; a non-zero count leaves the asset in place for a later run.
This matches the `PlaylistItem.mediaAssetId` FK, which is `onDelete: Restrict` and would
otherwise reject the delete outright.

### Limitation: revision covers structure, not asset content

`revision` captures the playlist's structure and its items' settings, and nothing else.
Editing a referenced asset in the library or archiving it from there does not bump any
playlist that points at it. Sync tolerates this by design: it always returns a freshly
filtered list, dropping an asset that has become archived or non-`READY` since the last
poll, and a presigned URL it hands back can still fail if the object was removed between
assembly and playback, so the device must tolerate a dead media URL.

## Campaigns

The Campaigns subsystem (increment 6) runs an existing playlist across a group of screens
for an absolute date window. While a campaign is active for a screen it takes over from
that screen's base `Screen.playlistId`. It adds no new infrastructure: the winning
campaign's playlist is assembled by the same `assembleManifest` path the base playlist
uses.

### Data model

Three models, added in migration `20260831190318_campaigns`:

- **`Campaign`** points at one `Playlist` (`playlistId`, `onDelete: Restrict`) and carries
  an absolute UTC window (`startsAt`, `endsAt`), an `Int` `priority` (default 0), an
  `enabled` flag, a monotonic `revision` (see below), a nullable `createdByUserId`
  (`onDelete: SetNull`), and a nullable `archivedAt` for soft-delete. Because `playlistId`
  is `Restrict`, `deletePlaylist` first counts the campaigns that reference the playlist
  and refuses the delete ("That playlist is used by a campaign. Remove it from the campaign
  first.") when the count is non-zero.
- **`CampaignScreen`** targets one screen; **`CampaignLocation`** targets one location.
  Both are tenant-scoped join rows, each `@@unique` on its `(campaignId, <target>)` pair,
  and both cascade from either side. A location target resolves to that location's direct
  screens only: there is no location-tree descent in this increment.

`Campaign`, `CampaignScreen` and `CampaignLocation` join `TENANT_MODELS` (now 30) and all
three get the standard `ENABLE` + `FORCE ROW LEVEL SECURITY` `tenant_isolation` policy in
the same migration. `TENANT_MODELS` in `tenant.ts` now lists 30 entries;
`src/lib/db/tenant-model-list.test.ts` holds it, the union of the RLS migration `ARRAY`
blocks, and `TENANT_TABLES` in the isolation suite to the same set.

### Resolving what a screen plays

`resolveScreenContent` (`src/lib/player/campaign.ts`) is pure: no I/O, no database, and it
never throws. Given a screen, an instant, and the campaigns that could apply to it, it
returns `{ source: "campaign", ... }`, `{ source: "playlist", ... }`, or
`{ source: "none" }`.

A campaign is a candidate when every one of these holds:

- `enabled` is true and `archivedAt` is null;
- the instant is inside a half-open window, `startsAt <= now < endsAt` (a campaign whose
  `endsAt` equals now is already over);
- it targets the screen directly through a `CampaignScreen` row, or targets the screen's
  own location through a `CampaignLocation` row.

Among the candidates the winner is the one with the highest `priority`; a tie breaks to the
earliest `endsAt`, then to the lowest `id`, so the result is deterministic on identical
input. The resolver does not inspect playlist health: a candidate that points at an
archived playlist still wins. With no candidate it falls back to `Screen.playlistId`, and
with neither a candidate nor a base playlist it returns `source: "none"`.

### The revision contract

`Campaign.revision` is a monotonic `Int` that starts at 1 and is only ever incremented,
never set to an absolute value. `bumpCampaignRevision(tx, campaignId)`
(`src/lib/campaigns/revision.ts`) does the increment inside the same `withOrgTransaction`
that made the change, so the write and the bump commit together. A device's change key is
the tuple `(source, campaign?.id, campaign?.revision, playlist.id, playlist.revision)`: it
must compare `campaign.id` and `playlist.id` alongside the revisions, not the revision
alone, because two campaigns are both born at `revision: 1` and a change of winning campaign
would otherwise go unnoticed.

What bumps it: `updateCampaign` (name, description, playlist, window, priority),
`setCampaignEnabled`, and `setCampaignTargets` (any screen or location target change), since
each of those feeds a screen's effective content. What does not: `createCampaign` (the row
is born at 1), `deleteCampaign`, and `archiveCampaign` / `restoreCampaign`. An archived or
deleted campaign stops being a candidate immediately (sync filters `archivedAt: null` and
the resolver rejects archived rows), so the device detects the change because `source`
flips back to `"playlist"` (or `"none"`) on its next poll, and `source` is part of the
change key.

### Sync and preview

`GET /api/player/sync` resolves the effective playlist through `resolveScreenContent` before
it assembles anything. It loads the org's active campaigns targeting the screen or its
location, hands them to the resolver, then assembles whichever playlist won exactly as
before. The payload carries two extra fields:

- `source`: `"campaign"`, `"playlist"`, or `"none"`.
- `campaign`: `{ id, name, revision, endsAt }` when a campaign won, otherwise `null`.

`playlist` is still the assembled manifest, or `null`, now of whichever playlist the
resolver selected.

`GET /api/campaigns/[id]/preview` is the session-authed operator preview. It is gated by
`requireRole("campaign.view")`, resolves the campaign to its `playlistId` through the tenant
facade (so an id outside the caller's active organization reads as absent), and returns the
identical `{ id, name, revision, items }` shape as the playlist preview by reusing
`assemblePlaylistPreview` (`src/lib/player/preview.ts`), the helper shared with the playlist
preview route. Those values describe the campaign's playlist, not the campaign.

### Authorization

Four policy rows in `src/lib/rbac/policy.ts`:

| Action | Roles |
| --- | --- |
| `campaign.view` | all roles |
| `campaign.create` | `MANAGER` and up |
| `campaign.update` | `MANAGER` and up |
| `campaign.delete` | `MANAGER` and up |

The sidebar's Campaigns link (`src/lib/nav.ts`) is gated on `campaign.view`.

### Limitation: a boundary lands on the next poll

Nothing pushes a campaign change to a screen. A screen re-resolves its content only on its
next `GET /api/player/sync`, so a campaign that starts or ends between two polls takes
effect up to one `pollIntervalSeconds` late. Priority changes, target changes and enable or
disable carry the same up-to-one-interval lag.

## Schedule

The Schedule subsystem (increment 7) adds recurring weekly day-parting: a screen can carry
a set of rules, each playing a playlist or a campaign on chosen weekdays inside a
minute-of-day window, optionally bounded by an effective date range. A matching rule takes
over from the screen's base `Screen.playlistId` but yields to an active campaign. It adds
no new infrastructure: the winning rule's playlist is assembled by the same
`assembleManifest` path the base playlist and campaigns use.

### Data model

Three models, added in migration `20260901203759_schedule`:

- **`ScheduleRule`** carries `daysOfWeek` (an `Int[]` of `0`-`6`, Sunday is `0`), a half-open
  minute window (`startMinute` `0`-`1439`, `endMinute` `1`-`1440`, `endMinute > startMinute`),
  a nullable `@db.Date` effective range (`effectiveFrom`, `effectiveUntil`, both inclusive),
  an `enabled` flag, a monotonic `revision` (see below), a nullable `createdByUserId`
  (`onDelete: SetNull`), and a nullable `archivedAt` for soft-delete. Exactly one of
  `playlistId` / `campaignId` is set, enforced by the `schedule_rule_payload_xor` CHECK
  constraint; a second CHECK, `schedule_rule_minute_bounds`, pins the minute ranges. Both
  `playlist` and `campaign` are `onDelete: Restrict`, so a payload a rule references cannot
  be hard-deleted.
- **`ScheduleRuleScreen`** targets one screen; **`ScheduleRuleLocation`** targets one
  location. Both are tenant-scoped join rows, each `@@unique` on its
  `(scheduleRuleId, <target>)` pair, and both cascade from either side. A location target
  resolves to that location's direct screens only: there is no location-tree descent in this
  increment, matching campaigns.

`ScheduleRule`, `ScheduleRuleScreen` and `ScheduleRuleLocation` join `TENANT_MODELS` (now
33) and all three get the standard `ENABLE` + `FORCE ROW LEVEL SECURITY` `tenant_isolation`
policy in the same migration. `TENANT_MODELS` in `tenant.ts` now lists 33 entries;
`src/lib/db/tenant-model-list.test.ts` holds it, the union of the RLS migration `ARRAY`
blocks, and `TENANT_TABLES` in the isolation suite to the same set.

### Resolving what a screen plays

Two pure helpers in `src/lib/player/schedule.ts` do the time math, with no I/O:

- **`zonedNow(now, timeZone)`** projects an instant into a location's wall clock through
  `Intl.DateTimeFormat`, returning `{ weekday, minute, date }`. An unrecognized zone throws
  `RangeError`, which the caller catches.
- **`scheduleRuleMatches(candidate, at)`** is true when `at.weekday` is in the rule's
  `daysOfWeek`, `at.minute` falls in the half-open `[startMinute, endMinute)` window, and
  `at.date` is inside the inclusive effective range (open on a null bound).

`GET /api/player/sync` loads the screen's enabled, non-archived rules (targeting the screen
or its location), evaluates each with `zonedNow` in the screen's location time zone, keeps
the matches, and resolves the winner. `resolveScreenContent` (`src/lib/player/campaign.ts`)
then picks the effective content in four tiers, highest first:

    campaign  >  schedule rule  >  base playlist (Screen.playlistId)  >  none

A schedule rule whose payload is a campaign still reports `source: "schedule"`, but the
`campaign` object is populated from that campaign so a device can tell the identity apart.

### The revision contract

`ScheduleRule.revision` is a monotonic `Int` that starts at 1 and is only ever incremented.
`bumpScheduleRevision(tx, id)` (`src/lib/schedule/revision.ts`) does the increment inside
the same `withOrgTransaction` that made the change. What bumps it: `updateScheduleRule`
(name, payload, window, days, effective range), `setScheduleRuleEnabled`, and
`setScheduleRuleTargets`. What does not: `createScheduleRule` (born at 1),
`deleteScheduleRule`, and `archiveScheduleRule` / `restoreScheduleRule`. An archived or
deleted rule stops being a candidate immediately, so the device detects the change because
`source` flips back to `"campaign"`, `"playlist"` or `"none"` on its next poll, and `source`
is part of the change key.

### The non-overlap invariant

`assertNoScheduleOverlap` (`src/lib/schedule/overlap.ts`) runs inside the transaction on
every write path except `deleteScheduleRule` and `archiveScheduleRule`, before the commit.
Two rules overlap when their resolved screen sets intersect **and** their weekdays, their
half-open minute windows, and their inclusive effective-date ranges all overlap at once
(adjacent minute windows, `a.endMinute === b.startMinute`, do not). A `ScheduleOverlapError`
is caught in the action and returned as `{ error }`, which rolls the transaction back, so no
single save can knowingly introduce a pair of rules that both match one screen at one
instant. That is the guarantee the check gives, and it is not absolute: see the limitation
below.

### Sync payload

`GET /api/player/sync` gains a `schedule` key alongside the `source` / `campaign` fields
that Campaigns added:

- `source`: now `"campaign"`, `"schedule"`, `"playlist"`, or `"none"`.
- `schedule`: `{ id, name, revision, playlistId, campaignId }` when a rule won, otherwise
  `null`. `campaignId` is set only when the winning rule's payload is a campaign.

`playlist` is still the assembled manifest, of whichever playlist the resolver selected.

### Authorization

Five policy rows in `src/lib/rbac/policy.ts`: `schedule.view` (all roles), and
`schedule.create` / `schedule.update` / `schedule.delete` / `schedule.assign` (`MANAGER`
and up). The sidebar's Schedule link (`src/lib/nav.ts`) is gated on `schedule.view`.

### Limitation: concurrent writes or a moved screen can create a latent overlap

`assertNoScheduleOverlap` can only check the screen sets and rows that exist at save time.
Two writes to two different rules that run concurrently each pass the guard against the
pre-write state and then both commit, so an overlapping pair can land even though no single
save saw it. Separately, if a location rule and a screen rule do not share a screen when they
are written, both save; if a screen is later moved into that location, the two rules now both
match it, and nothing re-runs the guard. Sync tolerates both cases rather than crashing: when
more than one rule matches a screen it sorts the matches by ascending `id`, takes the lowest,
and writes one `overlapping schedule rules` warning to the log with every matching rule id.
The pick is deterministic, so the screen plays a stable choice until an operator edits one of
the rules.
Separately, a location whose time zone `Intl` does not recognize makes `zonedNow` throw
`RangeError`; the schedule tier is skipped for that screen (a warn log, no crash) and the
base playlist is served.

## Analytics

The Analytics subsystem (increment 8) adds proof-of-play: paired players report the airings
they actually displayed, and the `/analytics` page reads those rows back as summary tiles, a
plays-by-day chart, a per-asset content-performance table, and per-campaign and
per-schedule-rule proof-of-play tables. It adds one table and one route on the write side and
a small set of read functions on the report side. There is no aggregation job and no
dashboard cache: every number is computed from the raw event rows on each page load.

### Data model

One model, added in migration `20260902120000_analytics`:

- **`PlaybackEvent`** carries `organizationId`, `screenId`, a nullable `mediaAssetId` /
  `playlistId` / `campaignId` / `scheduleRuleId` (all `onDelete: SetNull`, so a report can
  outlive the content it references), a `source` string (`"playlist"`, `"campaign"` or
  `"schedule"`), an `airedAt` timestamp, an `Int durationSeconds`, and a `receivedAt` default
  now. Its `id` is a **client-supplied string**, not a generated cuid: the player picks the
  id, so it is the idempotency key for ingestion. Five indexes cover the report queries:
  `(organizationId, airedAt)`, `(organizationId, mediaAssetId, airedAt)`,
  `(organizationId, campaignId, airedAt)`, `(organizationId, scheduleRuleId, airedAt)`,
  `(screenId, airedAt)`, and `(airedAt)` (the last leads with `airedAt` so the retention prune
  is a bounded range scan). The primary key is composite, `(organizationId, id)`: the row id is
  client-supplied, so the identity has to be tenant-local or a guessed id from one tenant could
  collide with another tenant's row at the index level, below RLS, and be silently dropped by
  `skipDuplicates`. `PlaybackEvent` joins `TENANT_MODELS` (now 34) and gets the standard
  `ENABLE` + `FORCE ROW LEVEL SECURITY` `tenant_isolation` policy in the same migration; a
  CHECK constraint (`playback_event_duration_nonneg`) keeps `durationSeconds` in `[0, 86400]`.
  The `source` string is constrained in zod at the API edge only, not by the database.

### Ingestion: `POST /api/player/events`

A paired player POSTs a batch of airings with its bearer device token. The route
(`src/app/api/player/events/route.ts`):

- authenticates the device, then safe-parses the body against `playbackBatchSchema`
  (`src/lib/validation/analytics.ts`): a non-JSON or schema-invalid body is a 422, an
  `events` array longer than 500 is a 413.
- rejects the whole batch with a 400, writing nothing, if any event names a `screenId` other
  than the reporting screen.
- drops events whose `airedAt` falls outside the ingest window `[now - 7d, now + 1h]`
  (`withinIngestWindow`, both bounds inclusive, for clock skew and batch delay) and counts
  them as `dropped`. They are never stored.
- resolves every `mediaAssetId` / `playlistId` / `campaignId` / `scheduleRuleId` against the
  reporting screen's organization; an id that does not resolve is stored as `null`, so a
  stale or cross-org client reference never dangles a foreign key.
- inserts with `createMany({ skipDuplicates: true })`. Because `id` is the client-supplied
  idempotency key, a replayed batch inserts nothing and every row already present is reported
  back as a duplicate. `skipDuplicates` dedupes on the composite primary key
  `(organizationId, id)`, so the identity is `(organizationId, id)` and a collision cannot
  cross tenants.

The response is `{ accepted, duplicates, dropped }`: `accepted` is the `createMany` count,
`duplicates` is `kept - accepted`, `dropped` is the count outside the window.

### Compute-on-read reporting

There are no rollup tables. Four functions read the raw rows through the tenant facade, each
opening its own `withOrgTransaction` so RLS and guard-layer-1 both scope the organization,
and each returning ISO strings for every date so no `Date` crosses into a client component:

- **`getPlaybackSummary`** (`src/lib/analytics/summary.ts`) -- four scalar totals for the
  tiles: `totalPlays`, `totalPlaySeconds`, `reportingScreens`, `distinctAssets`. The two
  simple aggregates go through Prisma; the two `COUNT(DISTINCT ...)` values need one
  parameterized raw query on the same transaction.
- **`getContentPerformance`** (`src/lib/analytics/content.ts`) -- a `GROUP BY "mediaAssetId"`
  rollup (plays, seconds, distinct screens, last aired) joined to `MediaAsset` for names and
  kinds, rows with a null asset collapsed into one "Unattributed" row, plus a per-UTC-day
  play count zero-filled across the whole range for the chart.
- **`getCampaignProofOfPlay`** / **`getScheduleProofOfPlay`** (`src/lib/analytics/proof-of-play.ts`)
  -- the same grouped query over `campaignId` or `scheduleRuleId`: airings, seconds, distinct
  screens and locations reached, first and last airing. A group whose id no longer resolves
  to a live row is dropped, because proof-of-play is about entities that still exist.

The range comes from `?from` / `?to` (inclusive end day, exclusive bound is that day plus
one), each defaulting to a rolling 30 days, with `?location` / `?screen` as optional
narrowings. `AnalyticsRange`, `playbackEventWhere` and `playbackEventRawFilter`
(`src/lib/analytics/types.ts`) express that filter once for the Prisma path and once for the
raw-SQL path so the two cannot drift; `zeroFillByDay`, `secondsToHM` and `playHours`
(`src/lib/analytics/shape.ts`) do the presentation math.

Why no rollup tables yet: at demo and early-customer volume the raw table is small enough
that a handful of indexed `GROUP BY` queries per page load is cheaper than the machinery to
keep a rollup correct. When the raw table grows large enough that the report queries slow
down, the documented next step is a periodic per-day-per-entity rollup table that the report
functions read instead, with the raw rows kept only for the retention window.

### Retention

`prunePlaybackEvents` (`src/worker/jobs/prunePlaybackEvents.ts`) hard-deletes rows whose
`airedAt` is older than 90 days. It runs unscoped across every organization, writes no audit
row (a periodic retention delete is not an organization action), and the worker fires it
every hour (`PRUNE_PLAYBACK_INTERVAL_MS`).

### Authorization

One policy row in `src/lib/rbac/policy.ts`: `analytics.view` (all roles). The sidebar's
Analytics link (`src/lib/nav.ts`) is gated on it. The page calls `requireRole("analytics.view")`,
which scopes `ctx.db` and `ctx.organizationId`.

## Canvas editor

The Canvas editor (increment 5, Plan 1) turns the `Canvas` / `Panel` / `Frame` / `Content`
hierarchy that has existed in the schema since Foundation into an in-app authoring surface: a
canvas index at `/canvas`, a drag-and-snap panel editor at `/canvas/[id]`, a per-panel frame
strip, and a content form per frame. A screen can now show a canvas in place of a playlist.
The `/canvas` list draws each canvas as a lightweight panel wireframe rather than mounting
`CanvasStage`, so it renders panel outlines only; thumbnails that show the actual frame media
are a deferred follow-up.

### Data model

A `Canvas` owns `Panel` rows, each `Panel` owns ordered `Frame` rows, and each `Frame` owns
one `Content` row with a single typed sub-record. Plan 1 authors five frame types: `CLOCK`,
`PICTURE`, `VIDEO`, `MEMO`, and `WEB`. `WEB` and its `Web` model (`{ url }`) are new in this
increment and bring the RLS tenant-table count to 35. The `WEATHER` and `NEWS` frame types
already in the enum are Plan 2 live-data frames and have no authoring UI yet.

### The revision contract

`Canvas.revision` is a monotonic `Int` that starts at 1 and is only ever incremented.
`bumpCanvasRevision(tx, id)` (`src/lib/canvas/revision.ts`) runs as the first statement of
every mutating canvas transaction, the same pattern `Playlist`, `Campaign`, and
`ScheduleRule` follow. `createCanvas` and `duplicateCanvas` write a row already at 1 and do
not bump; every later panel, frame, and content mutation bumps, because all of them change
what a screen renders.

### Resolving what a screen plays

The canvas tier sits between the schedule tier and the base playlist, so the full precedence
in `resolveScreenContent` is now `campaign > schedule > canvas > base playlist > none`. A
screen carrying a `canvasId` with no winning campaign and no matching schedule rule serves an
assembled canvas manifest; a canvas that has been removed or has no renderable panels falls
through to the base playlist.

### Sync payload

`assembleCanvasManifest` (`src/lib/player/canvas-manifest.ts`) turns a loaded canvas tree
into the `CanvasManifest` a paired screen receives: panels in `zIndex` then `id` order, each
frame resolved to a renderable kind, every image, video, and background storage key signed
once. `buildCanvasManifest` (`src/lib/player/canvas-preview.ts`) is the I/O wrapper that
loads the tree and signs the keys, shared by `GET /api/canvas/[id]/preview` and the canvas
tier of `GET /api/player/sync`. Every `GET /api/player/sync` response now carries a `canvas`
key of type `CanvasManifest | null`: it holds the manifest on a canvas hit and is `null` on
every other response.

### Switching a screen between playlist and canvas

`setScreenContentSource` (`src/app/(app)/screens/actions.ts`) points one screen at a
playlist, a canvas, or nothing. `Screen.playlistId` and `Screen.canvasId` are mutually
exclusive: the action writes both foreign keys on every call, so choosing one source nulls
the pointer the screen no longer uses. Switching a screen's source is not a structural canvas
edit, so it never bumps a canvas revision.

### Authorization

Four policy rows in `src/lib/rbac/policy.ts`: `canvas.view` (all roles) and `canvas.create` /
`canvas.update` / `canvas.delete` (`CONTENT_MANAGER` and up). The sidebar's Canvas link
(`src/lib/nav.ts`) is gated on `canvas.view`.

## Environment variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | Must point at a `NOSUPERUSER` role (see Multi-tenancy). |
| `AUTH_SECRET` | Auth.js session and token signing | Generate with `npm run generate-key`. |
| `AUTH_URL` | Canonical app URL | Its scheme decides secure-cookie behavior. Production must be `https://`. |
| `APP_ENCRYPTION_KEY` | HMAC key for device tokens; at-rest key for integration secrets | Required. Generate with `npm run generate-key`. Vitest loads it from `.env`. |
| `EMAIL_SERVER` | SMTP URL for outbound mail | Used by the worker's mailer. |
| `EMAIL_FROM` | From address for outbound mail | |
| `DISPLAYMONKEY_MSSQL_URL` | Display Monkey SQL Server source | Read only by `scripts/migrate-displaymonkey.ts`, never by the app runtime. |
| `DATABASE_POOL_MAX` | `pg` pool size | Optional, defaults to 10. Must parse as a positive integer; a non-numeric value throws at startup rather than silently falling back. |
| `SEED_SUPERADMIN_EMAIL` | Super-admin address for `db:seed` | Optional, defaults to `admin@lynesign.local`. |
| `SEED_SUPERADMIN_PASSWORD` | Super-admin password for `db:seed` | Required when `NODE_ENV=production`; without it the seed skips the super admin instead of using the dev default. |
| `E2E_BUILD` | Set by the Playwright web server only | Switches `next.config.ts` off `output: "standalone"` so `next start` works. |
| `STORAGE_ENDPOINT` | S3-compatible endpoint URL | Set for MinIO (local dev, test, CI); unset for real AWS S3. Its presence also switches the client to path-style addressing. |
| `STORAGE_REGION` | S3 region | Defaults to `us-east-1`. |
| `STORAGE_BUCKET` | Bucket holding every media object | Required. `lynesign-media` locally. |
| `STORAGE_ACCESS_KEY_ID` | S3 access key id | Required. |
| `STORAGE_SECRET_ACCESS_KEY` | S3 secret access key | Required. |
| `STORAGE_PUBLIC_URL` | CDN base URL for public asset delivery | Optional, unset today. Deferred hook for player delivery (see Media). |

`.env.example` is committed with every key present and empty or safe-default. `.env` is
git-ignored.

## Deployment

`docker-compose.yml` describes the production-parity topology:

- **`postgres`** (`postgres:18-alpine`), data on a named volume, host port 5433. It mounts
  `docker/postgres-init/` at `/docker-entrypoint-initdb.d/`, whose `01-app-role.sql` creates
  the `lynesign_app` `LOGIN NOSUPERUSER` role and hands it ownership of the database and the
  `public` schema. Init scripts run once, on first initialisation of an empty data
  directory, as the bootstrap superuser. An existing volume predates that file: recreate it
  with `docker compose down -v`, or create the role by hand.
- **`migrate`**, a one-shot service that runs `npx prisma migrate deploy` and exits.
- **`web`**, built from the `web` stage of the `Dockerfile`: the Next.js standalone
  server (`node server.js`). `next.config.ts` sets `output: "standalone"` for this image.
- **`worker`**, built from the `worker` stage: `npx tsx src/worker/index.ts`. It is a
  separate process with the full `node_modules` tree, because the standalone trace for the
  web bundle excludes `tsx` and the worker's imports. `web` and `worker` both wait for
  `migrate` to complete.

Inside the compose network the database host is the service name `postgres` on port 5432,
so the compose files hard-code `DATABASE_URL` and override anything a mounted `.env`
supplies. All three services (`migrate` included) connect as `lynesign_app`, never as the
image's `POSTGRES_USER`: that account is a superuser, and a superuser bypasses row-level
security even under `FORCE ROW LEVEL SECURITY`, so pointing the app at it would switch off
Layer 2 while every test still passed. `lynesign_app` owns the database and the `public`
schema and has `CREATEDB`, so it can run every migration.

A real deployment must: run `migrate` before `web` and `worker`, connect as a
`NOSUPERUSER` role, set `AUTH_URL` to the public `https://` origin, and supply real
`AUTH_SECRET`, `APP_ENCRYPTION_KEY` and SMTP settings.

**CI.** `.github/workflows/ci.yml` runs on push and pull request: one job on
`ubuntu-latest` that starts a `postgres:16` service, creates the `lynesign_app`
`NOSUPERUSER` role and the `lynesign` and `lynesign_test` databases, then runs
`prisma migrate deploy` and `db:seed`, brings up MinIO with `npm run storage:up` (the same
downloaded-binary harness as local dev, since the runner has no long-lived object-storage
service), then `lint`, `typecheck`, `test` (Vitest), `playwright install --with-deps
chromium`, and `test:e2e` (the Playwright core-journey and tenant-isolation suites). The
non-superuser role is the load-bearing detail: without it the RLS and isolation tests pass
without exercising anything.

## Decisions and deviations from the plan

These are grounded in the SDD progress ledger
(`.superpowers/sdd/2026-08-29-lynesign-foundation/progress.md`), rulings R1 through R10.

- **R1: schema back-relations split across two migrations.** `Organization` declares
  back-relations to `Location` / `Screen` / `Canvas` only in the migration that also
  defines those models, so each migration applies standalone.
- **R2: typed detail models written out in full.** The plan's one-line shorthand for the
  eleven typed tables is not valid Prisma; each is a normal model with the field names and
  defaults shown.
- **R3: Vitest file parallelism disabled.** The whole unit suite shares one Postgres
  instance and some files issue `DELETE FROM`; `fileParallelism: false` serializes them.
- **R4: known placeholders resolved.** The dark-theme `--primary` token ships as
  `#33538A`, and the pairing test identifiers ship as plain ASCII.
- **R5: no Docker on the build machine.** `docker compose up postgres` was the plan; the
  machine has no Docker daemon. Local development and tests run against an
  `embedded-postgres` cluster driven by `scripts/dev-db.mjs` (persistent `./.pgdata`, port
  5433). `docker-compose.yml` is retained for parity and production. The Media subsystem's
  object store is handled the same way: `scripts/dev-storage.mjs` runs a downloaded MinIO
  binary as a subprocess on port 9000 (`npm run storage:up`), no Docker.
- **R6: RLS requires a non-superuser role.** The embedded-postgres bootstrap role is a
  superuser and superusers bypass RLS, so `dev-db.mjs` also creates `lynesign_app`
  (`LOGIN NOSUPERUSER CREATEDB`) and makes it own the database. `DATABASE_URL` uses it.
- **R7: the tenancy mechanism.** Probing proved that driving the RLS GUC through the
  vanilla Prisma client rolls writes back. The shipped design is the `$extends` query
  extension (Layer 1) plus the `@prisma/adapter-pg` driver adapter carrying
  `SET LOCAL app.current_org` in an interactive transaction (Layer 2). The real cause of
  the early failure was the empty-string GUC reset value, fixed by the fourth migration.
- **R8: `forOrg` gets the RLS backstop.** `forOrg` composes on `withOrgTransaction` so
  every operation runs inside a GUC-scoped transaction. Per-call transaction overhead is
  accepted (see Multi-tenancy tech debt).
- **R9: composite-FK tenant hardening deferred.** A raw foreign key scalar pointing at
  another tenant's row still lands (Postgres exempts referential-integrity checks from
  RLS), and that row then becomes unreadable. Confidentiality holds (no cross-tenant read,
  no cross-tenant write of owned rows), but a caller passing a foreign id can poison its
  own row. The full fix (composite unique keys and composite foreign keys across roughly
  eight relations, plus a migration) is a tracked follow-up. Locations and screens
  validate foreign-key ownership before create as a partial mitigation.
- **R10: server-to-client `render` closures.** Server Components were passing `render`
  functions to the `"use client"` `DataTable`, which crashes React Server Component
  serialization in a production build. `screens/page.tsx` and `users/page.tsx` now extract
  `"use client"` table wrappers (`screens-table.tsx`, `members-table.tsx`) and pass only
  serializable props. `locations/page.tsx` never had the bug.
- **`OutboundEmail` added.** The spec implied an invitation-email retry queue but did not
  model it. It is a global, non-tenant table, so it is absent from the RLS policy list.
- **`output: "standalone"` gated.** It is incompatible with `next start`, which the
  Playwright harness uses, so it is switched off when `E2E_BUILD=1`.

## Migration from Display Monkey

Run with `npm run migrate:dm -- --mssql-url "<sql server url>"` or
`npm run migrate:dm -- --fixture <path>`. See `scripts/migrate-displaymonkey.ts` and
`scripts/dm/`.

**Preserved.** The domain model shape: the `Canvas` / `Panel` / `Frame` / `Content` tree,
the eleven typed content tables, the `Location` hierarchy, and pairing as a first-class
screen concept.

**Changed.** The framework (ASP.NET plus the Display Monkey player, now Next.js plus a
future player runtime). Both user interfaces are rebuilt. Authentication moves to Auth.js
database sessions. The schema is now multi-tenant: every tenant table gains
`organizationId` and a row-level-security policy.

**Migrated.** `Level` and `Location` (a Level becomes a parent `Location` with a synthetic
negative `legacyId`), `Display` (to `Screen`, unpaired), `Canvas`, `Panel`, `Frame`,
`Content` and its typed detail rows, `FrameLocation`, and `Users` (to a global `User` plus
a `Membership`, with a synthetic email and `mustResetPassword = true`). Integration
accounts land as `LegacyIntegration` rows with secret-bearing fields stripped. Every
insert is a per-row `upsert` keyed on `legacyId`, so the script is idempotent. After the
writes it reconciles source against destination row counts and exits non-zero on any
mismatch.

**Manual action required.**

- **Supply real email addresses before anyone can sign in.** Display Monkey has no email
  column, so `scripts/dm/map.ts` gives every imported user a synthetic address of the form
  `dm.<uname>.<orgId>@import.lynesign.local`. That address is a placeholder, not a mailbox:
  it is undeliverable, so a password-reset blast to it goes nowhere, and it is not an
  address any user knows, so it cannot be typed at the sign-in form either. Imported
  accounts are therefore unusable until an operator supplies a real `uname -> email`
  mapping. Two ways to do that, both manual today:
  1. Update each imported `User.email` to the person's real address (from an HR list, the
     AD directory, or whatever the Display Monkey deployment used out-of-band), then send
     the reset blast. Imported users land with no password and `mustResetPassword = true`,
     so the forced-reset flow takes it from there.
  2. Or delete the imported placeholder users and re-invite each person at their real
     address through `/users`, which creates the membership on accept.

  Tracked follow-up (not built): teach `scripts/migrate-displaymonkey.ts` an optional
  `--email-map <file.json>` flag mapping `uname` to a real address, applied during the
  user upsert so the import lands with deliverable addresses and step 1 disappears.
- Re-pair every screen: imported screens are `UNPAIRED` and need a fresh pairing code and
  device token.
- Re-enter every integration credential: secrets are not carried across.
- **Swap the frame-type mapping.** `scripts/dm/map.ts`'s `FRAME_TYPE_BY_DM_INT` uses the
  simplified fixture convention (`0 -> CLOCK`, `1 -> PICTURE`, `4 -> HTML`) exercised by
  `map.test.ts`. It does not match Display Monkey's real `FrameTypes` enum, and real
  Display Monkey has no `Frame.Type` column at all (the kind is derived from
  `Template.FrameType`). Before any real-data run, populate `DmFrame.Type` from
  `Template.FrameType` and replace the mapping table with the real enum
  (`Clock=0, Html=1, Memo=2, Outlook=4, Picture=5, Report=6, Video=7, Weather=8,
  YouTube=9, Powerbi=10`).

**Known limits.**

- The live SQL Server path (`--mssql-url`, dynamic `mssql` import) has not been run against
  real data; only the JSON fixture path is exercised by tests.
- `legacyId` is globally `@unique`, so one Display Monkey database maps to exactly one
  organization. Importing the same dump into a second org fails on the first collision.
- Imported users carry synthetic, undeliverable email addresses. See the manual action
  above; nobody can sign in until real addresses are supplied.

## Known issues and remaining tech debt

Synthesized from the ledger's deferred-minor lines.

- **Composite-FK tenant hardening (R9).** Deferred. A foreign-key id from another tenant
  can be written and produces an unreadable row. Confidentiality is intact; availability
  and integrity for the poisoning tenant are not.
- **`forOrg` per-operation transactions (R8).** One pooled-connection checkout per call.
  `getDashboardData` now batches its reads into a single `withOrgTransaction`, but every
  other multi-read page still pays per call. Needs a hot-path optimization and likely a
  larger pool before heavy load.
- **`embedded-postgres` is a beta pin** (`18.4.0-beta.17`). It crashed once mid-setup on
  Windows during the build (shared-memory error); recovery is
  `npm run db:down && rm -rf .pgdata && npm run db:up && prisma migrate deploy && npm run db:seed`.
  CI does not use it.
- **Cross-test-file database contamination.** `rls.test.ts` runs `DELETE FROM "Organization"`
  in `beforeAll`, which cascades into other files' fixtures. Worked around with
  `fileParallelism: false`, unique emails and slugs, and a catalog-driven `resetDb()`
  helper for the Playwright suites. A per-file cleanup would be cleaner.
- **Hand-maintained table lists.** The 34-tenant-table list appears in the RLS migrations,
  again in `rls.test.ts`, and is derived from the schema in `tenant.ts`. Adding a tenant
  table to one place only would not be flagged.
- **Untested paths.** `getServerAuth`, `signOutAction`, `requestPasswordReset` and
  `resetPassword` have no direct unit tests (reset is covered by the e2e suite). The
  `DataTable` sort and pagination are untested. The sweep job's audit-write path is not
  covered.
- **Minor timing side-channels** in sign-in and password-reset (email enumeration by
  response time). Acknowledged, not mitigated.
- **Compose tenant isolation is unverified end to end.** `docker/postgres-init/01-app-role.sql`
  and the `lynesign_app` URLs were written and reviewed but never brought up: there is no
  Docker on the machine the fix was applied from. Confirm on a Docker host that `migrate`,
  `web` and `worker` connect as a non-superuser and that the isolation suite still passes
  against that database.
- **DM import email mapping.** `scripts/migrate-displaymonkey.ts` could take an optional
  `--email-map <file.json>` (`uname` to real address) so imported users land with
  deliverable addresses instead of the synthetic `@import.lynesign.local` placeholder.

### Schedule (increment 7) deferrals

- **The non-overlap invariant is not serializable.** `assertNoScheduleOverlap` runs inside
  the write transaction and `bumpScheduleRevision` locks the edited rule's row, but two
  concurrent writes to *different* rules that would overlap each other each pass the check
  against pre-write state and both commit. A screen moved into a location after rules
  exist can also leave a latent overlap that was uncheckable at save time. The player
  degrades deterministically (lowest rule `id` wins, one `overlapping schedule rules` warn
  line), so this is a soundness gap, not a crash. A per-org advisory lock around every
  schedule write would close it.
- **Overlap check is over-strict on paused rules.** `updateScheduleRule` gates the check
  on the post-write `enabled`, but `createScheduleRule` and `restoreScheduleRule` run it
  unconditionally, so creating or restoring a *disabled* rule that would overlap an
  enabled one is refused even though a disabled rule never resolves. Harmonize all three
  to skip the check when the candidate ends up disabled.
- **Dialog polish.** The dialog does not roll back its optimistic `enabled` toggle when
  `setScheduleRuleEnabled` returns an error; it cannot clear a rule's name back to null
  (empty maps to "unchanged"); a stale restore error can reappear when the archived panel
  is re-opened; `schedule-rule-dialog.tsx` is ~640 lines and the weekday / target /
  payload field groups would extract cleanly.

### Analytics (increment 8) deferrals

- **Prune deletes by a key `OR` list.** `prunePlaybackEvents` selects up to 5000
  `(organizationId, id)` keys per pass and deletes them with an `OR` of composite keys.
  Correct and bounded, but a keyset range delete on the new `PlaybackEvent_airedAt_idx`
  would be leaner.
- **Report path fires four transactions per page load.** `/analytics` calls the four
  report functions in parallel, each opening its own `withOrgTransaction` (Prisma's 5s
  interactive-transaction default). Fine at current volume; once the raw table is large
  these should share one transaction or carry an explicit longer timeout, and the rollup
  table noted above becomes the real fix.
- **Filters AND with no cross-clear.** Selecting a location does not clear an
  already-selected screen, so a screen in a different location plus that location yields
  zero rows with no hint why. Clearing `screen` when `location` changes is a one-line fix.
- **A disabled screen can still ingest.** `authenticateDevice` matches on the device
  token hash alone with no `status` check, so `POST /api/player/events` (like `sync` and
  `heartbeat`) accepts airings from a screen an operator has disabled.
- **Deleted-asset display.** `getContentPerformance` renders `assetName: ""` for a
  non-null `mediaAssetId` whose `MediaAsset` row is gone (only reachable via a
  read-committed race inside the transaction). Decide on `"Unattributed"` or the raw id.
- **Device clock trust and UTC bucketing.** `airedAt` is the device clock, bounded only
  by the `[now-7d, now+1h]` ingest window; `byDay` buckets at UTC, so a screen far from
  UTC can have an airing land on the "wrong" calendar day. Per-screen-timezone bucketing
  (the screen's location already carries `timeZone`) is a later refinement.

## Recommended next steps

The Foundation build was increment 1 of the plan. Increment 3 (Media library), increment 4
(Playlist authoring), increment 5 Plan 1 (Visual canvas editor), increment 6 (Campaigns),
increment 7 (Schedule) and increment 8 (Analytics) have shipped since. Increment 2 (Player
runtime) was planned but not built; it leads the open list below.

- **Media library.** Upload, object storage, and the `Picture` / `Video` asset pipeline.
- **Playlist authoring.** `Playlist` / `PlaylistItem`, the list and editor pages,
  `playlist.*` RBAC with a nav gate, the `purgeArchivedMedia` guard, and on-demand manifest
  assembly at `GET /api/player/sync`.
- **Visual canvas editor (Plan 1).** The `Canvas` / `Panel` / `Frame` / `Content` authoring
  UI at `/canvas` and `/canvas/[id]`, the five Plan 1 frame types (`CLOCK`, `PICTURE`,
  `VIDEO`, `MEMO`, `WEB`) with the new `Web` model, `canvas.*` RBAC with a nav gate,
  `bumpCanvasRevision`, the canvas tier in `resolveScreenContent`, `assembleCanvasManifest`,
  `setScreenContentSource`, and the `canvas` key on `GET /api/player/sync`.
- **Campaigns.** `Campaign` / `CampaignScreen` / `CampaignLocation`, the list and editor
  pages, `campaign.*` RBAC with a nav gate, the `deletePlaylist` guard, campaign resolution
  in `resolveScreenContent`, and the `source` / `campaign` fields on
  `GET /api/player/sync`.
- **Schedule.** `ScheduleRule` / `ScheduleRuleScreen` / `ScheduleRuleLocation`, the
  per-screen week grid and rule dialog, `schedule.*` RBAC with a nav gate, `zonedNow` +
  `scheduleRuleMatches`, the `assertNoScheduleOverlap` write-time invariant, the schedule
  tier in `resolveScreenContent`, and the `schedule` key on `GET /api/player/sync`.
- **Analytics.** `PlaybackEvent` keyed on `(organizationId, id)` with a client-supplied
  idempotency id, the
  `POST /api/player/events` batch ingest, the compute-on-read report functions
  (`getPlaybackSummary`, `getContentPerformance`, `getCampaignProofOfPlay`,
  `getScheduleProofOfPlay`), the `/analytics` page with its filters, tiles, plays-by-day
  chart and proof-of-play tables, `analytics.view` RBAC with a nav gate, and the
  `prunePlaybackEvents` 90-day retention job. Screen-health reporting is not part of this
  increment.

The open increments, in order:

1. **Player runtime (increment 2).** The actual device-facing player that consumes `sync`,
   posts `heartbeat` and `events`, and renders a canvas. Nothing in this repo drives those
   routes today except the test suites and the `simulate-*` scripts.
2. **Canvas editor Plan 2 (increment 5).** The `WEATHER` and `NEWS` live-data frame types:
   their `Weather` and `News` models, provider wiring, an authoring form per frame, and
   manifest assembly for the live payloads. Plan 1 shipped the layout surface and the five
   static frame types; this is the immediate follow-up.
3. **Screen-health analytics.** Persist heartbeat history and report per-screen uptime,
   offline incidents, and last-seen trends. The proof-of-play increment deliberately left
   this out; the data source (`Screen.lastSeenAt` plus a new history table) is separate
   from `PlaybackEvent`.
4. **Billing with Stripe, the platform admin console, and notifications.** Turn the
   read-only billing page into real subscription management, build out the `isSuperAdmin`
   surface, and add user-facing notifications.
