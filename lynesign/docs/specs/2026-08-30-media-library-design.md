# Media Library — Design Spec

Date: 2026-08-30
Status: Approved for planning
Author: Eugenio Costa (with Claude)
Increment: 3 of the LyneSign roadmap (first increment after the Foundation)

---

## 1. Context

The LyneSign Foundation shipped the multi-tenant base: schema, RLS, auth, RBAC,
org/location/screen hierarchy, the app shell, and management pages for screens,
locations, users, and billing. Five roadmap subsystems remain: **Media,
Playlists, Campaigns, Schedule, Analytics.**

They stack rather than parallelize (playlists arrange media; schedule sequences
playlists; campaigns flight playlists across screen groups; analytics measures
playback). This spec covers **Media only.** Playlists + a real player runtime
is the next increment; Schedule, Campaigns, and Analytics follow.

### What exists today that this builds on

- `Content` + typed detail tables `Picture`, `Video`, `Youtube`, `Html`,
  `Weather`, `News`, `Clock`, `Memo`, `Outlook`, `Report`, `Powerbi` — carried
  from Display Monkey, no management UI. `Picture.mediaRef` / `Video.mediaRef`
  are free-text `String?` placeholders.
- `Plan.maxStorageBytes` and `getStorageUsage(organizationId)` in
  `src/lib/plan-limits/index.ts` — the latter returns `usedBytes: 0n` today.
  The dashboard storage tile and the billing usage bar already render it.
- `src/app/(app)/media/page.tsx` renders `<ComingSoon feature="Media" ... />`.
  `src/lib/nav.ts` has a `/media` nav item with no `action` gate.
- The tenant facade `forOrg` / `withOrgTransaction` (`src/lib/db/tenant.ts`),
  the `$extends` scoping guard, and Postgres RLS on 23 tenant tables (list
  triplicated across the RLS migration `ARRAY[...]`, `TENANT_MODELS` in
  `tenant.ts`, and `TENANT_TABLES` in `src/test/isolation/rls.test.ts`).
- The `tsx` worker (`src/worker/index.ts`) with `sweepOfflineScreens` and
  `sendInvitationEmails`, plus the `OutboundEmail` retry-queue pattern.
- The design system (tokens, shadcn/ui) and app components (`PageHeader`,
  `EmptyState`, `DataTable`, `StatTile`, `Dialog`, `DropdownMenu`).
- `sharp` is transitively available in the workspace (used by Next image
  optimization); it will be added as a direct dependency here.

---

## 2. Scope

### In scope

1. `MediaAsset` and `MediaFolder` models + migration + RLS.
2. `Picture.mediaAssetId` / `Video.mediaAssetId` columns + relations.
3. `src/lib/storage/` — an S3-compatible `StorageProvider` abstraction with one
   implementation, plus a MinIO service in `docker-compose.yml` for local dev.
4. The upload pipeline: `requestUpload` / `finalizeUpload` server actions,
   direct-to-storage presigned PUT, inline image processing, a worker job for
   video probing, a stuck-upload sweep.
5. The `/media` library page (replaces the ComingSoon placeholder): folders,
   search, kind filter, sort, drag-drop upload with progress, grid of media
   cards, preview dialog, rename/move/tag, bulk actions, "add web content"
   URL form, a live storage-usage bar, an empty state.
6. RBAC: new `media.*` actions in `POLICY`, the `/media` nav item gated.
7. `getStorageUsage` made real; `assertCanAddStorage` added and enforced.
8. Extended tenant-isolation suite + unit / integration / e2e coverage.
9. `.env.example` + `docs/architecture.md` + `README.md` updates.

### Out of scope (later increments)

- The frame/canvas editor that assigns a `MediaAsset` to a `Frame`
  (`mediaAssetId` columns land now; the picker UI is increment 4).
- The player runtime and real `/api/player/sync` manifest assembly.
- Video transcoding, adaptive bitrate, DRM.
- Audio, PDF, PowerPoint, or document media kinds.
- A CDN in front of the bucket (env hook `STORAGE_PUBLIC_URL` is added; wiring
  it into player delivery is increment 4).
- Per-folder permissions (folders are org-wide in v1).

---

## 3. Architecture

### 3.1 Upload data flow

```
browser                 Next server (action)         object storage (S3/MinIO)
  |  requestUpload({filename,mimeType,sizeBytes,folderId?})
  | ----------------------> |
  |                         |  requireRole("media.create")
  |                         |  classify kind, check MIME allowlist
  |                         |  assertCanAddStorage(org, sizeBytes)
  |                         |  enforce per-kind hard size cap
  |                         |  create MediaAsset {status: UPLOADING, storageKey}
  |                         |  storage.createUploadUrl(storageKey, mimeType, cap)
  | <---------------------- |  { assetId, uploadUrl }
  |                                                   |
  |  HTTP PUT file bytes (XHR, progress events) ----> |
  |  <---------------------------------------------- 200
  |  finalizeUpload(assetId)
  | ----------------------> |
  |                         |  storage.headObject(storageKey) -> verify size+type
  |                         |  IMAGE: sharp -> width/height + thumbnail (inline)
  |                         |  VIDEO: enqueue processMediaAsset job
  |                         |  compute checksum (stream from storage), flag dupes
  |                         |  MediaAsset.status = READY (or FAILED)
  | <---------------------- |  { status }
```

No file bytes ever transit the Next server. The server issues a signed URL
scoped to one exact key, content-type, and byte cap, valid 5 minutes.

### 3.2 New dependencies

- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — S3 + MinIO client and
  presigner.
- `sharp` — image dimension probe + thumbnail generation (promote to a direct
  dependency; add to `package.json` `allowScripts` — it has a native postinstall).
- `ffprobe`/`ffmpeg` are NOT added as npm/system dependencies. The worker's
  video job shells out to `ffprobe` if it is on `PATH` and degrades gracefully
  (no duration, generic thumbnail) if it is not. Documented as an optional
  production dependency.

### 3.3 docker-compose

Add a `minio` service (`minio/minio`, console + API ports, a persistent
volume, `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) and a one-shot
`minio-setup` service (`minio/mc`) that waits for MinIO, creates the bucket,
and sets it to private. `web` and `worker` gain the `STORAGE_*` env pointing
at `http://minio:9000`.

---

## 4. Data model

### 4.1 `MediaFolder` (tenant-scoped)

```prisma
model MediaFolder {
  id             String   @id @default(cuid())
  organizationId String
  parentId       String?
  name           String
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime @updatedAt @db.Timestamptz(3)

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parent       MediaFolder?  @relation("MediaFolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children     MediaFolder[] @relation("MediaFolderTree")
  assets       MediaAsset[]

  @@unique([organizationId, parentId, name])
  @@index([organizationId])
}
```

Deleting a folder cascades to child folders (self-relation `onDelete: Cascade`)
and null-outs `folderId` on any assets it held (asset relation
`onDelete: SetNull`), moving them to the root. Both are handled by the schema's
`onDelete` behaviors; the delete action only adds the audit entry.

### 4.2 `MediaAsset` (tenant-scoped)

```prisma
enum MediaKind {
  IMAGE
  VIDEO
  WEB
}

enum MediaStatus {
  UPLOADING
  READY
  FAILED
}

model MediaAsset {
  id               String      @id @default(cuid())
  organizationId   String
  folderId         String?
  kind             MediaKind
  status           MediaStatus @default(UPLOADING)
  name             String
  originalFilename String?
  mimeType         String?
  sizeBytes        BigInt      @default(0)
  storageKey       String?     // null for WEB
  thumbnailKey     String?
  checksum         String?     // sha256 hex, null until finalized
  width            Int?
  height           Int?
  durationSeconds  Int?
  url              String?     // set for kind = WEB, null otherwise
  tags             String[]    @default([])
  createdByUserId  String?
  createdAt        DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime    @updatedAt @db.Timestamptz(3)
  archivedAt       DateTime?   @db.Timestamptz(3)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  folder       MediaFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)
  createdBy    User?        @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
  pictures     Picture[]
  videos       Video[]

  @@index([organizationId, folderId])
  @@index([organizationId, kind])
  @@index([organizationId, checksum])
  @@index([organizationId, status])
}
```

- `storageKey` is always `org/<organizationId>/<assetId>/original<ext>`,
  `thumbnailKey` is `org/<organizationId>/<assetId>/thumb.webp`. Both are
  derived server-side from the row; never accepted from the client.
- `WEB` assets have no `storageKey` / `thumbnailKey` / `sizeBytes` (0) and are
  created `READY` immediately by a separate action.
- Soft delete sets `archivedAt`. Archived assets are excluded from the library,
  from storage-usage totals, and from the picker. Hard delete (row + objects)
  happens only for assets with `archivedAt` set, past a grace period, that no
  `Picture`/`Video` references — done by a worker job.

### 4.3 Content-skeleton wiring

```prisma
model Picture {
  // ... existing fields ...
  mediaAssetId String?
  mediaAsset   MediaAsset? @relation(fields: [mediaAssetId], references: [id], onDelete: SetNull)
}

model Video {
  // ... existing fields ...
  mediaAssetId String?
  mediaAsset   MediaAsset? @relation(fields: [mediaAssetId], references: [id], onDelete: SetNull)
}
```

`mediaRef` (free text) is left untouched for Display Monkey migration
compatibility. No UI populates `mediaAssetId` this increment; the column exists
so "used in N frames" queries and the delete rule work.

### 4.4 RLS + facade integration

`MediaFolder` and `MediaAsset` are tenant-scoped. The migration for this
increment MUST:

- add both to the `tenant_isolation` policy set (ENABLE + FORCE ROW LEVEL
  SECURITY, the `coalesce(current_setting('app.current_org', true), '') = '' OR
  "organizationId" = ...` policy, USING + WITH CHECK), matching
  `20260830032500_rls_empty_guc_is_unscoped`;
- the implementer updates all THREE hand-maintained copies of the tenant-table
  list: the RLS migration `ARRAY[...]`, `TENANT_MODELS` in `src/lib/db/tenant.ts`
  (so `forOrg(org).mediaAsset` / `.mediaFolder` are exposed and injected), and
  `TENANT_TABLES` in `src/test/isolation/rls.test.ts`. A test asserting the
  three agree is added in this increment to stop the drift.

`Picture` / `Video` already carry `organizationId` and are already in the RLS
set; adding `mediaAssetId` does not change that.

---

## 5. Storage layer — `src/lib/storage/`

### 5.1 Interface (`src/lib/storage/index.ts`)

```ts
export interface UploadTarget {
  url: string;            // presigned PUT URL
  headers: Record<string, string>; // required request headers (Content-Type, etc.)
  expiresAt: Date;
}

export interface StorageProvider {
  createUploadUrl(key: string, contentType: string, maxBytes: number): Promise<UploadTarget>;
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  getObjectStream(key: string): Promise<NodeJS.ReadableStream>;
  headObject(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>; // remove all objects under org/<id>/<assetId>/
}

export const storage: StorageProvider; // singleton, S3StorageProvider
```

### 5.2 `S3StorageProvider` (`src/lib/storage/s3.ts`)

`@aws-sdk/client-s3` `S3Client` configured from env, `forcePathStyle: true`
when `STORAGE_ENDPOINT` is set (MinIO). `createUploadUrl` uses
`getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType,
ContentLength range enforced via a signed policy or ContentLength param }),
{ expiresIn: 300 })`. Fails fast with a clear error if any required
`STORAGE_*` var is missing.

### 5.3 Env vars

| Var | Purpose | Local (MinIO) |
|---|---|---|
| `STORAGE_ENDPOINT` | S3 API endpoint; empty for real AWS S3 | `http://localhost:9000` (dev) / `http://minio:9000` (compose) |
| `STORAGE_REGION` | S3 region | `us-east-1` |
| `STORAGE_BUCKET` | bucket name | `lynesign-media` |
| `STORAGE_ACCESS_KEY_ID` | credential | MinIO root user |
| `STORAGE_SECRET_ACCESS_KEY` | credential | MinIO root password |
| `STORAGE_PUBLIC_URL` | optional CDN/base URL for player delivery (unused this increment) | empty |

All added to `.env.example`. Local dev prerequisite for storage-touching work
is `docker compose up -d minio` (no separate node harness — Docker is available
where MinIO is needed, and the unit suite mocks the provider). `README.md` adds
this as an optional step ("only needed to work on Media"). Pure unit tests use
a mock `StorageProvider`; integration and e2e need a live endpoint, which CI
provides as a service container and local dev provides via that compose
service. An integration test with no reachable endpoint self-skips with a
message telling the developer to start MinIO.

---

## 6. Server actions & routes

All under `src/app/(app)/media/actions.ts` (`"use server"`), gated per §7.

- `createFolder(formData)` — `requireRole("media.folder.manage")`; validate
  `{ name, parentId? }`; parent must belong to the org (facade lookup);
  create; `writeAudit("media.folder.create")`; `revalidatePath("/media")`.
- `renameFolder(id, name)` / `moveFolder(id, parentId?)` /
  `deleteFolder(id)` — same gate. Delete is a plain `ctx.db.mediaFolder.delete`;
  the schema's `onDelete` cascades child folders and null-outs the assets'
  `folderId` (see 4.1), so no asset is ever removed by a folder delete. The
  action verifies same-org and writes the audit.
- `requestUpload({ folderId?, filename, mimeType, sizeBytes })`:
  `Promise<{ assetId: string; upload: UploadTarget } | { error: string }>` —
  `requireRole("media.create")`; `mimeType` -> `kind` via the allowlist
  (`image/jpeg|png|webp|gif` -> IMAGE; `video/mp4|webm` -> VIDEO; anything else
  -> `{ error }`); reject if `sizeBytes` exceeds the per-kind cap
  (`MEDIA_MAX_BYTES.IMAGE = 25MiB`, `.VIDEO = 500MiB`); `assertCanAddStorage`;
  create `MediaAsset { status: UPLOADING, kind, name: deriveName(filename),
  originalFilename, mimeType, sizeBytes, storageKey }`; return a presigned PUT.
- `finalizeUpload(assetId)`: `Promise<{ status: "READY" | "FAILED" }>` —
  `requireRole("media.create")`; asset must be the caller's org and
  `UPLOADING`; `headObject` -> if missing or size/type mismatch, set `FAILED`
  and return; for IMAGE, stream the object, `sharp().metadata()` for
  `width`/`height`, generate a <= 480px `thumb.webp`, `putObject`; compute
  sha256 while streaming, set `checksum`; for VIDEO enqueue a
  `MediaProcessingJob` row (new lightweight queue table, or reuse a generic
  jobs table — see §8); set `status: READY`; `writeAudit("media.upload")`;
  if another non-archived READY asset in the org has the same `checksum`, still
  succeed but include `{ duplicateOf }` in the return for a UI hint.
- `createWebContent(formData)` — `requireRole("media.create")`; validate
  `{ name, url }` (`https?:` only, no `javascript:`/`data:`); create
  `MediaAsset { kind: WEB, status: READY, url }`; audit.
- `updateAsset(id, { name?, tags?, folderId? })` — `requireRole("media.update")`;
  folder (if set) must be same-org; audit `media.update`.
- `deleteAssets(ids: string[])` — `requireRole("media.delete")`; for each: if a
  non-archived `Picture`/`Video` references it, soft-delete (`archivedAt = now`);
  else soft-delete too (a worker purges objects later — deletion is never
  synchronous with object removal); audit `media.delete` with the count.
- `restoreAsset(id)` — `requireRole("media.update")`; clears `archivedAt` if the
  object still exists (`headObject`); audit.
- `mediaDownloadUrl(id)` — a small server action or route
  (`GET /api/media/[id]/url`) returning a fresh 1-hour presigned GET for the
  library preview; `requireRole("media.view")` and org check. The library never
  embeds long-lived URLs.

`redirect` is not used by any of these; they return values and the page
revalidates.

---

## 7. RBAC

Add to `src/lib/rbac/policy.ts` `Action` + `POLICY`:

| Action | Roles |
|---|---|
| `media.view` | all (OWNER, ADMIN, MANAGER, CONTENT_MANAGER, VIEWER) |
| `media.create` | OWNER, ADMIN, MANAGER, CONTENT_MANAGER |
| `media.update` | OWNER, ADMIN, MANAGER, CONTENT_MANAGER |
| `media.delete` | OWNER, ADMIN, MANAGER |
| `media.folder.manage` | OWNER, ADMIN, MANAGER, CONTENT_MANAGER |

`src/lib/nav.ts`: the `/media` item gets `action: "media.view"` (currently
ungated). `visibleNav` already filters on it.

---

## 8. Plan limits & the worker

### 8.1 Storage usage becomes real

`src/lib/plan-limits/index.ts`:

- `getStorageUsage(organizationId)` -> `usedBytes` =
  `mediaAsset.aggregate({ _sum: { sizeBytes }, where: { organizationId,
  archivedAt: null, status: { in: ["READY", "UPLOADING"] } } })` (BigInt sum;
  guard null -> `0n`). `limitBytes` unchanged (`plan.maxStorageBytes`).
- `assertCanAddStorage(organizationId, addBytes: bigint)` -> throws
  `PlanLimitError("Your plan includes N of storage. Free up space or upgrade.")`
  when `used + addBytes > limit` and `limit` is not null.
- `getUsageSummary` already surfaces `storage`; it now returns real numbers,
  so the dashboard tile and billing bar update with no further change.

### 8.2 Worker jobs

Add to `src/worker/index.ts`:

- `processMediaAsset` (every 20s, batch): for `MediaAsset` rows flagged for
  video processing (a `MediaProcessingJob` table: `id`, `mediaAssetId`,
  `status PENDING|DONE|FAILED`, `attempts`, `lastError?`, timestamps — global
  table, no `organizationId`, not in the RLS set, same shape as `OutboundEmail`).
  Runs `ffprobe` if available for `durationSeconds` + a poster frame at 1s via
  `ffmpeg`; on absence, sets a generic video thumbnail key and leaves duration
  null; marks `DONE`. Bounded retries (`attempts < 5`).
- `sweepStuckUploads` (every 5 min): `MediaAsset` where `status = UPLOADING`
  and `createdAt < now - 1h` -> `deletePrefix(org/<id>/<assetId>/)`, set
  `status = FAILED`. Per-org `writeAudit("media.upload.expired", { count })`.
- `purgeArchivedMedia` (every 15 min): `MediaAsset` where `archivedAt < now -
  7 days` and no non-archived `Picture`/`Video` references it -> `deletePrefix`,
  then delete the row. Audit per org.

The worker must not import `next/*` (existing constraint); the storage client
and `sharp` are Node-only and fine.

---

## 9. Library UI — `src/app/(app)/media/`

`page.tsx` (server): `requireRole("media.view")`; read `searchParams`
(`folder?`, `q?`, `kind?`, `sort?`, `page?`); load the folder breadcrumb, the
child folders of the current folder, and a paginated `MediaAsset` page
(`archivedAt: null`, filtered), plus `getStorageUsage`. Render `<PageHeader>` +
`<StorageBar>` + `<MediaLibrary>` (client).

Client components under `src/components/app/media/`:

- `media-library.tsx` — owns the drag-drop upload zone (whole grid), the
  upload queue + progress state, and renders the toolbar + grid + bulk bar.
- `media-toolbar.tsx` — folder breadcrumb, search input (debounced, updates
  the URL), kind filter, sort select, "New folder" and "Add web content"
  dialogs, an "Upload" button (opens the OS file picker; same handler as drop).
- `media-card.tsx` — thumbnail (or a kind glyph for WEB / while processing),
  name, kind `Badge`, human size, a "used in N" chip when referenced, a select
  checkbox, a `DropdownMenu` (Preview, Rename, Move, Tags, Delete).
- `media-preview-dialog.tsx` — full image, `<video controls>`, or a sandboxed
  `<iframe>` for WEB; shows metadata (dimensions, duration, size, uploaded by,
  tags, folder, "used in").
- `folder-crumbs.tsx` + `move-to-folder-dialog.tsx` + `tag-editor.tsx`.
- `upload-queue.tsx` — per-file rows with progress bars, retry on failure,
  auto-dismiss on success; calls `requestUpload` -> XHR PUT with
  `upload.headers` and `onprogress` -> `finalizeUpload`.
- `storage-bar.tsx` — used vs limit, turns amber past 80%, links to `/billing`.

Empty state via `<EmptyState>` ("No media yet. Upload images and video, or add
a web page, to build your library." + an Upload action). Copy rules: no em
dashes, emojis, exclamation points.

---

## 10. Security

- Presigned PUT: one exact key, exact `Content-Type`, `ContentLength` bounded
  to the requested `sizeBytes` (reject a larger body), 5-minute expiry.
- Presigned GET: 1-hour expiry, minted per request through `media.view` + org
  check; never stored in the DB or embedded in server-rendered HTML beyond the
  immediate response.
- `storageKey` / `thumbnailKey` always `org/<organizationId>/...`, computed
  from the row, never from client input. Even a bucket-policy mistake cannot
  let org A address org B's objects through the app.
- MIME allowlist enforced in `requestUpload` and re-verified against
  `headObject().contentType` in `finalizeUpload`. A mismatch -> `FAILED`.
- Per-kind hard byte caps independent of the plan quota.
- `WEB` URL: `new URL()` parse, protocol in `{http, https}`, reject
  credentials in the URL; rendered only in a `sandbox`-ed iframe.
- Object deletion is always asynchronous (worker) and gated on "no live
  reference", so a mistaken delete of an in-use asset is recoverable via
  `restoreAsset` within the grace window.
- Tenant-isolation suite (`src/test/isolation/tenant-isolation.spec.ts`)
  extended: as org A, every media action against an org B `assetId` /
  `folderId` returns `{ error }` / throws and mutates nothing;
  `forOrg(A).mediaAsset.findMany()` never returns B's rows; a raw
  `withOrgTransaction(A, tx => tx.$queryRawUnsafe('... "MediaAsset"'))` sees
  none of B's ids.

---

## 11. Testing

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | MIME->kind classifier; per-kind caps; `assertCanAddStorage` (bigint); `getStorageUsage` real sum; the `finalizeUpload` state machine (missing object, size mismatch, happy path) with a mocked `StorageProvider`; checksum + duplicate flag; the new `media.*` RBAC rows; `deriveName`/`storageKey` builders; `TENANT_MODELS` == RLS `ARRAY` == `TENANT_TABLES` equality test |
| Integration | Vitest + MinIO (or a fake S3) + Postgres | `requestUpload` -> PUT -> `finalizeUpload` -> READY, thumbnail object exists; `sweepStuckUploads` flips a stale UPLOADING; `deleteAssets` soft-deletes a referenced asset and a worker `purgeArchivedMedia` removes an unreferenced archived one; `createWebContent` |
| Isolation | Vitest | cross-org media access blocked on every action + facade + raw SQL (see §10) |
| E2E | Playwright | sign in -> `/media` -> drag an image in -> progress -> card with thumbnail -> create a folder -> move the asset -> add a tag -> filter by tag -> preview -> delete -> storage bar decreases; add a web-content URL and see the WEB card |
| CI | GitHub Actions | the existing job gains a `minio` service container + `STORAGE_*` env + bucket creation before the test steps |

Definition of done: all suites green; `npm run build` clean; `docker compose
up` brings up `minio` and the bucket; the `/media` page replaces the
ComingSoon placeholder and round-trips an upload against MinIO.

---

## 12. Deliverables

1. Migration adding `MediaFolder`, `MediaAsset`, the two enums, the
   `Picture.mediaAssetId` / `Video.mediaAssetId` columns, and RLS for the two
   new tables; the three tenant-table lists updated + an equality test.
2. `src/lib/storage/` (interface + S3 impl + singleton) and `docker-compose.yml`
   + `.env.example` + optional `scripts/dev-storage.mjs`.
3. `src/app/(app)/media/actions.ts`, `src/app/api/media/[id]/url/route.ts`.
4. `src/lib/plan-limits` changes (`getStorageUsage`, `assertCanAddStorage`).
5. `src/lib/rbac/policy.ts` + `src/lib/nav.ts` changes.
6. Worker: `processMediaAsset`, `sweepStuckUploads`, `purgeArchivedMedia` +
   the `MediaProcessingJob` model.
7. `src/app/(app)/media/page.tsx` + `src/components/app/media/*`.
8. Tests per §11; CI workflow update.
9. `docs/architecture.md` (a "Media" section: model, storage abstraction,
   upload flow, the env vars, the worker jobs, the deferred CDN hook) and
   `README.md` (MinIO in the local setup steps) updates.

---

## 13. Environment variables (added)

`STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`,
`STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL`
(optional). All in `.env.example`; CI sets them to the MinIO service values.

---

## 14. Risks and open questions

- **`sharp` on the build/runner.** It ships prebuilt binaries for common
  platforms and is already in the tree via Next; the increment adds it as a
  direct dep and to `allowScripts`. If a target platform lacks a prebuild the
  image build must compile it — flagged for the CI first run.
- **`ffprobe` availability.** Treated as optional. Video assets without it get
  no duration and a generic thumbnail; the library still works. Adding
  `ffmpeg` to the production image is a documented recommendation, not a
  requirement.
- **MinIO in unit tests.** Pure unit tests mock `StorageProvider`. Only the
  integration and e2e layers need a live endpoint; CI provides a `minio`
  service. Local `npm run test` without MinIO skips the integration file with
  a clear message (or the developer runs `docker compose up -d minio`).
- **`forOrg` per-op transactions (Foundation R8).** The library page issues
  several scoped reads; follow the dashboard precedent and batch them into one
  `withOrgTransaction` where they are on the request path.
- **Checksum on finalize streams the whole object back through the server.**
  For a 500MB video that is bandwidth inside the cluster. Acceptable for v1;
  a follow-up can move hashing to the client (pre-signed with a
  `x-amz-checksum-sha256` header) or skip it for video.
- **No CDN.** Library previews use presigned GETs straight from the bucket.
  Player delivery (increment 4) will need `STORAGE_PUBLIC_URL` + cache headers;
  the hook is present, the wiring is deferred.
