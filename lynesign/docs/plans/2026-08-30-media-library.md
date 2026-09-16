# Media Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the LyneSign Media library — org-scoped image/video/web assets with folders and tags, direct-to-storage presigned uploads on an S3-compatible provider, a `/media` management page, real plan-storage enforcement, and the worker jobs that process and garbage-collect media.

**Architecture:** New tenant-scoped `MediaFolder` / `MediaAsset` tables under the existing RLS + `forOrg` facade. A `StorageProvider` abstraction with one S3 implementation (MinIO locally, S3/R2 in prod). The browser uploads bytes straight to storage via a short-lived presigned PUT; the Next server only issues signed URLs and tracks metadata. Image dimensions + thumbnail are computed inline on finalize; video probing and all object deletion happen in worker jobs.

**Tech Stack:** Next.js 16.2.11, React 19, Prisma 6.19.x + `@prisma/adapter-pg`, PostgreSQL, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `sharp`, MinIO, Vitest, Playwright.

**Spec:** `docs/specs/2026-08-30-media-library-design.md`

## Global Constraints

- Branch `media-library` off `main`. Runtime pins unchanged from the Foundation (`next@16.2.11`, `react@19.2.4`, `prisma`/`@prisma/client`/`@prisma/adapter-pg@^6.19.3`, `zod@^4`). TypeScript `strict`.
- **Local object storage without Docker.** Docker is unavailable in this environment (Foundation Ruling R5). Local dev + tests run against a real MinIO **binary** driven as a subprocess by `scripts/dev-storage.mjs` (`npm run storage:up` / `storage:down`), the same pattern `scripts/dev-db.mjs` uses for embedded Postgres. `docker-compose.yml` still gains a `minio` service for production parity. If the MinIO binary cannot be fetched on the build machine, Task 1 falls back to `s3rver` and documents that presigned-URL fidelity is lower.
- Every tenant-data read/write goes through `forOrg` / `withOrgTransaction`. `MediaAsset` and `MediaFolder` are added to `TENANT_MODELS` (`src/lib/db/tenant.ts`), the RLS migration table `ARRAY`, and `TENANT_TABLES` (`src/test/isolation/rls.test.ts`) — all three, plus a new test that asserts they agree.
- Raw `prisma` (`@/lib/db/root`) is import-restricted by the ESLint `no-restricted-imports` rule added in the Foundation fix wave. Any new file that needs it (worker jobs, the storage route with device/no-org context) must be added to that rule's allow-list with a one-line reason.
- Every mutating server action: `requireRole(...)` before the write, `writeAudit(...)` after. `redirect()` (if any) stays outside try/catch.
- Copy rules (`voice.md`): no em dashes, no emojis, no exclamation points. Error text says what happened and what to do.
- `storageKey` / `thumbnailKey` are always `org/<organizationId>/<assetId>/...`, derived server-side from the row, never from client input.
- MIME allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/gif` -> `IMAGE`; `video/mp4`, `video/webm` -> `VIDEO`. Anything else is rejected at `requestUpload`. Hard caps: `IMAGE` 25 MiB, `VIDEO` 500 MiB, independent of plan quota.
- Presigned PUT expiry 300s; presigned GET expiry 3600s, minted per request behind `media.view` + org check.
- TDD: failing test first, watch it fail, implement, watch it pass, commit. Conventional Commits.
- Commands run from `lynesign/`. `npm run db:up` and `npm run storage:up` must both be running for the integration/e2e suites; pure unit tests mock `StorageProvider`.

---

## File Structure

```
lynesign/
  docker-compose.yml                      # + minio, minio-setup services
  .env.example                            # + STORAGE_* keys
  package.json                            # + @aws-sdk/*, sharp; scripts storage:up/down; allowScripts
  scripts/
    dev-storage.mjs                       # MinIO binary subprocess harness
  prisma/
    schema.prisma                         # + MediaFolder, MediaAsset, MediaProcessingJob, enums, Picture/Video cols
    migrations/<ts>_media_library/migration.sql
  src/
    lib/
      storage/
        index.ts                          # StorageProvider interface, `storage` singleton, key builders
        s3.ts                             # S3StorageProvider
        s3.test.ts                        # round-trip against local MinIO
      media/
        mime.ts                           # classifyKind, MEDIA_MAX_BYTES, deriveName, extForMime
        mime.test.ts
        web-url.ts                        # validateWebUrl
        web-url.test.ts
      db/
        tenant.ts                         # TENANT_MODELS += mediaAsset, mediaFolder
        tenant-model-list.test.ts         # NEW: asserts the 3 lists agree
      rbac/policy.ts                      # + media.* actions
      nav.ts                              # /media -> action: "media.view"
      plan-limits/index.ts                # getStorageUsage real; assertCanAddStorage
      plan-limits/plan-limits.test.ts     # + storage cases
    app/
      (app)/media/
        page.tsx                          # replaces ComingSoon
        actions.ts                        # requestUpload, finalizeUpload, folder/web/asset actions
        media.test.ts                     # action integration tests
      api/media/[id]/url/route.ts         # presigned GET for previews
    components/app/media/
      media-library.tsx  media-toolbar.tsx  media-card.tsx  media-preview-dialog.tsx
      folder-crumbs.tsx  move-to-folder-dialog.tsx  tag-editor.tsx  upload-queue.tsx
      storage-bar.tsx  new-folder-dialog.tsx  add-web-content-dialog.tsx
      media-card.test.tsx  storage-bar.test.tsx
    worker/
      index.ts                            # + 3 jobs on their intervals
      jobs/processMediaAsset.ts  jobs/sweepStuckUploads.ts  jobs/purgeArchivedMedia.ts
      jobs/media.test.ts
    test/
      isolation/tenant-isolation.spec.ts  # + media cross-org cases
      e2e/media.spec.ts                    # NEW
  .github/workflows/ci.yml                # + minio service, STORAGE_* env, bucket create
  docs/architecture.md                    # + Media section
  README.md                               # + MinIO local step
  eslint.config.mjs                       # allow-list additions for new raw-prisma files
```

---

## Task 1: Storage layer + MinIO harness

**Files:**
- Modify: `package.json` (deps `@aws-sdk/client-s3@^3`, `@aws-sdk/s3-request-presigner@^3`, `sharp@^0.34`; devDep `@aws-sdk/lib-storage@^3` if needed for streamed puts; `allowScripts` entry `"sharp": true`; scripts `"storage:up": "node scripts/dev-storage.mjs start"`, `"storage:down": "node scripts/dev-storage.mjs stop"`)
- Create: `scripts/dev-storage.mjs`
- Create: `src/lib/storage/index.ts`, `src/lib/storage/s3.ts`
- Modify: `.env.example`, `docker-compose.yml`
- Test: `src/lib/storage/s3.test.ts`

**Interfaces:**
- Consumes: env `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL?`.
- Produces:
  - `interface StorageProvider { createUploadUrl(key, contentType, maxBytes): Promise<UploadTarget>; createDownloadUrl(key, ttlSeconds): Promise<string>; putObject(key, body, contentType): Promise<void>; getObjectStream(key): Promise<Readable>; headObject(key): Promise<{ sizeBytes: number; contentType: string | null } | null>; deleteObject(key): Promise<void>; deletePrefix(prefix): Promise<void>; }`
  - `type UploadTarget = { url: string; headers: Record<string,string>; expiresAt: Date }`
  - `const storage: StorageProvider` (singleton S3StorageProvider, memoised on `globalThis` in dev like `prisma`).
  - `function assetStorageKey(orgId: string, assetId: string, ext: string): string` -> `org/${orgId}/${assetId}/original${ext}`
  - `function assetThumbKey(orgId: string, assetId: string): string` -> `org/${orgId}/${assetId}/thumb.webp`

- [ ] **Step 1: deps + scripts**

Add to `package.json` dependencies: `"@aws-sdk/client-s3": "^3.700.0"`, `"@aws-sdk/s3-request-presigner": "^3.700.0"`, `"sharp": "^0.34.0"`. Add `"sharp": true` to `allowScripts`. Add the two `storage:*` scripts. Run `npm install`.

- [ ] **Step 2: `scripts/dev-storage.mjs`**

```js
// Local S3 for dev/tests without Docker: runs the MinIO binary as a subprocess.
// Mirrors scripts/dev-db.mjs. `start` downloads the binary on first run into
// .minio/, launches it on :9000 with data in .minio/data, and ensures the
// bucket exists. `stop` kills it. Idempotent.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { platform, arch } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".minio");
const DATA = path.join(DIR, "data");
const PIDFILE = path.join(DIR, "minio.pid");
const BIN = path.join(DIR, platform() === "win32" ? "minio.exe" : "minio");
const PORT = 9000;
const USER = "lynesign";
const PASS = "lynesign-dev-secret";
const BUCKET = "lynesign-media";

function downloadUrl() {
  const os = platform() === "win32" ? "windows-amd64" : platform() === "darwin" ? `darwin-${arch() === "arm64" ? "arm64" : "amd64"}` : "linux-amd64";
  const file = platform() === "win32" ? "minio.exe" : "minio";
  return `https://dl.min.io/server/minio/release/${os}/${file}`;
}

async function ensureBinary() {
  if (existsSync(BIN)) return;
  mkdirSync(DIR, { recursive: true });
  console.log("Downloading MinIO binary (one time)...");
  const res = await fetch(downloadUrl());
  if (!res.ok) throw new Error(`MinIO download failed: ${res.status}. Fall back to s3rver (see plan Task 1).`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(BIN, Buffer.from(await res.arrayBuffer()));
  if (platform() !== "win32") chmodSync(BIN, 0o755);
}

async function ensureBucket() {
  const { S3Client, CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  const c = new S3Client({ endpoint: `http://localhost:${PORT}`, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: USER, secretAccessKey: PASS } });
  try { await c.send(new HeadBucketCommand({ Bucket: BUCKET })); return; } catch {}
  await c.send(new CreateBucketCommand({ Bucket: BUCKET }));
  console.log(`Created bucket ${BUCKET}`);
}

async function start() {
  await ensureBinary();
  mkdirSync(DATA, { recursive: true });
  // already running?
  try {
    const r = await fetch(`http://localhost:${PORT}/minio/health/live`);
    if (r.ok) { await ensureBucket(); console.log(`MinIO already up on :${PORT}`); return; }
  } catch {}
  const child = spawn(BIN, ["server", DATA, "--address", `:${PORT}`], {
    detached: true, stdio: "ignore", windowsHide: true,
    env: { ...process.env, MINIO_ROOT_USER: USER, MINIO_ROOT_PASSWORD: PASS },
  });
  child.unref();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(PIDFILE, String(child.pid));
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch(`http://localhost:${PORT}/minio/health/live`); if (r.ok) break; } catch {}
  }
  await ensureBucket();
  console.log(`MinIO up on :${PORT}  (user ${USER})`);
}

function stop() {
  if (!existsSync(PIDFILE)) { console.log("MinIO not running (no pidfile)"); return; }
  const { readFileSync, rmSync } = require("node:fs");
  const pid = Number(readFileSync(PIDFILE, "utf8"));
  try { process.kill(pid); } catch {}
  if (platform() === "win32") spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" });
  rmSync(PIDFILE, { force: true });
  console.log("MinIO stopped");
}

const cmd = process.argv[2];
if (cmd === "start") await start();
else if (cmd === "stop") stop();
else { console.error("usage: dev-storage.mjs start|stop"); process.exit(2); }
```

Add `/.minio/` to `.gitignore`.

- [ ] **Step 3: `.env.example` + `docker-compose.yml`**

`.env.example` append:
```
# Object storage (media). Local dev: npm run storage:up (MinIO on :9000).
STORAGE_ENDPOINT="http://localhost:9000"
STORAGE_REGION="us-east-1"
STORAGE_BUCKET="lynesign-media"
STORAGE_ACCESS_KEY_ID="lynesign"
STORAGE_SECRET_ACCESS_KEY="lynesign-dev-secret"
STORAGE_PUBLIC_URL=""
```
`docker-compose.yml`: add a `minio` service (`image: minio/minio`, `command: server /data --console-address ":9001"`, ports `9000:9000` and `9001:9001`, env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, a `minio_data` volume, healthcheck `curl -f http://localhost:9000/minio/health/live`) and a `minio-setup` one-shot (`image: minio/mc`, `entrypoint` that waits then `mc alias set` + `mc mb --ignore-existing` + `mc anonymous set none`). `web` and `worker` get `STORAGE_ENDPOINT: http://minio:9000` and the other `STORAGE_*` values in their `environment:`.

- [ ] **Step 4: `src/lib/storage/index.ts`**

```ts
import { S3StorageProvider } from "./s3";

export type UploadTarget = { url: string; headers: Record<string, string>; expiresAt: Date };

export interface StorageProvider {
  createUploadUrl(key: string, contentType: string, maxBytes: number): Promise<UploadTarget>;
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  getObjectStream(key: string): Promise<NodeJS.ReadableStream>;
  headObject(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

const g = globalThis as unknown as { storage?: StorageProvider };
export const storage: StorageProvider = g.storage ?? new S3StorageProvider();
if (process.env.NODE_ENV !== "production") g.storage = storage;

export function assetStorageKey(orgId: string, assetId: string, ext: string): string {
  return `org/${orgId}/${assetId}/original${ext.startsWith(".") ? ext : "." + ext}`;
}
export function assetThumbKey(orgId: string, assetId: string): string {
  return `org/${orgId}/${assetId}/thumb.webp`;
}
```

- [ ] **Step 5: `src/lib/storage/s3.ts`**

`S3StorageProvider implements StorageProvider`. Constructor reads the six env vars, throws `new Error("STORAGE_* env is not configured")` if `STORAGE_BUCKET`/`STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` are missing, builds an `S3Client({ endpoint: STORAGE_ENDPOINT || undefined, region: STORAGE_REGION || "us-east-1", forcePathStyle: !!STORAGE_ENDPOINT, credentials })`.
- `createUploadUrl(key, contentType, maxBytes)` -> `getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: maxBytes }), { expiresIn: 300 })`; return `{ url, headers: { "Content-Type": contentType }, expiresAt: new Date(Date.now() + 300_000) }`.
- `createDownloadUrl(key, ttl)` -> `getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttl })`.
- `putObject` -> `PutObjectCommand`. `headObject` -> `HeadObjectCommand`, map to `{ sizeBytes: ContentLength, contentType: ContentType ?? null }`, return `null` on `NotFound`. `getObjectStream` -> `GetObjectCommand`, return `Body as Readable`. `deleteObject` -> `DeleteObjectCommand`. `deletePrefix` -> `ListObjectsV2Command` paginated + `DeleteObjectsCommand` in batches of 1000.

- [ ] **Step 6: write the failing test `src/lib/storage/s3.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { storage, assetStorageKey } from "@/lib/storage";

const KEY = assetStorageKey("test-org", "test-asset-" + Date.now(), ".txt");

describe("S3StorageProvider against local MinIO", () => {
  it("round-trips put / head / get / delete", async () => {
    await storage.putObject(KEY, Buffer.from("hello lynesign"), "text/plain");
    const head = await storage.headObject(KEY);
    expect(head?.sizeBytes).toBe(14);
    const stream = await storage.getObjectStream(KEY);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("hello lynesign");
    await storage.deleteObject(KEY);
    expect(await storage.headObject(KEY)).toBeNull();
  });

  it("presigned PUT accepts a body that a presigned GET returns", async () => {
    const k = assetStorageKey("test-org", "presign-" + Date.now(), ".txt");
    const target = await storage.createUploadUrl(k, "text/plain", 1024);
    const put = await fetch(target.url, { method: "PUT", headers: target.headers, body: "signed body" });
    expect(put.ok).toBe(true);
    const getUrl = await storage.createDownloadUrl(k, 60);
    const got = await fetch(getUrl);
    expect(await got.text()).toBe("signed body");
    await storage.deletePrefix(`org/test-org/`);
  });

  it("deletePrefix removes everything under it", async () => {
    await storage.putObject("org/pfx/a/original.txt", Buffer.from("a"), "text/plain");
    await storage.putObject("org/pfx/b/original.txt", Buffer.from("b"), "text/plain");
    await storage.deletePrefix("org/pfx/");
    expect(await storage.headObject("org/pfx/a/original.txt")).toBeNull();
  });
});
```

- [ ] **Step 7: run it, expect fail** — `npm run storage:up` then `npm run test -- src/lib/storage/s3.test.ts`. Expected: FAIL (module missing / not implemented).

- [ ] **Step 8: implement s3.ts until green.** `npm run test -- src/lib/storage/s3.test.ts` -> PASS. Full `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` clean.

- [ ] **Step 9: vitest note** — in `vitest.config.ts` no change needed (env already loaded), but add a `src/lib/storage/s3.test.ts` guard: if `fetch("http://localhost:9000/minio/health/live")` fails in a `beforeAll`, `it.skip` the suite with a `console.warn("MinIO not running; run npm run storage:up")`. Keep the CI path (service container) unaffected.

- [ ] **Step 10: commit**

```bash
git add -A && git commit -m "feat: S3-compatible storage provider and local MinIO harness"
```

---

## Task 2: Media schema + migration + RLS + tenant-list sync

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_media_library/migration.sql` (RLS portion hand-authored via `--create-only`)
- Modify: `src/lib/db/tenant.ts` (`TENANT_MODELS`)
- Modify: `src/test/isolation/rls.test.ts` (`TENANT_TABLES`)
- Create: `src/lib/db/tenant-model-list.test.ts`
- Test: `prisma/media-schema.test.ts`, `src/test/isolation/rls.test.ts` (extended), `src/lib/db/tenant-model-list.test.ts`

**Interfaces:**
- Consumes: existing schema, the RLS policy shape from `20260830032500_rls_empty_guc_is_unscoped`.
- Produces: models `MediaFolder`, `MediaAsset`, `MediaProcessingJob`; enums `MediaKind` (`IMAGE VIDEO WEB`), `MediaStatus` (`UPLOADING READY FAILED`), `MediaJobStatus` (`PENDING DONE FAILED`); `Picture.mediaAssetId` + `Video.mediaAssetId` nullable + relations; RLS on `MediaFolder` + `MediaAsset`; `TENANT_MODELS` and `TENANT_TABLES` both gain `mediaAsset`/`MediaAsset` and `mediaFolder`/`MediaFolder`.

- [ ] **Step 1: write `prisma/media-schema.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const s = readFileSync("prisma/schema.prisma", "utf8");
describe("media schema", () => {
  it("declares the models and enums", () => {
    for (const m of ["model MediaFolder", "model MediaAsset", "model MediaProcessingJob", "enum MediaKind", "enum MediaStatus"]) {
      expect(s).toContain(m);
    }
  });
  it("MediaAsset is org-scoped, soft-deletable, and folder-linked", () => {
    const b = s.slice(s.indexOf("model MediaAsset"), s.indexOf("model MediaAsset") + 1400);
    expect(b).toMatch(/organizationId\s+String/);
    expect(b).toMatch(/archivedAt\s+DateTime\?/);
    expect(b).toMatch(/folderId\s+String\?/);
    expect(b).toMatch(/tags\s+String\[\]/);
  });
  it("Picture and Video link to MediaAsset", () => {
    expect(s).toMatch(/model Picture[\s\S]*mediaAssetId\s+String\?/);
    expect(s).toMatch(/model Video[\s\S]*mediaAssetId\s+String\?/);
  });
  it("MediaProcessingJob is global (no organizationId)", () => {
    const b = s.slice(s.indexOf("model MediaProcessingJob"), s.indexOf("model MediaProcessingJob") + 500);
    expect(b).not.toContain("organizationId");
  });
});
```

- [ ] **Step 2: run -> FAIL. Add to `prisma/schema.prisma`:**

```prisma
enum MediaKind { IMAGE VIDEO WEB }
enum MediaStatus { UPLOADING READY FAILED }
enum MediaJobStatus { PENDING DONE FAILED }

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
  storageKey       String?
  thumbnailKey     String?
  checksum         String?
  width            Int?
  height           Int?
  durationSeconds  Int?
  url              String?
  tags             String[]    @default([])
  createdByUserId  String?
  createdAt        DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime    @updatedAt @db.Timestamptz(3)
  archivedAt       DateTime?   @db.Timestamptz(3)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  folder       MediaFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)
  createdBy    User?        @relation("MediaUploader", fields: [createdByUserId], references: [id], onDelete: SetNull)
  pictures     Picture[]
  videos       Video[]
  @@index([organizationId, folderId])
  @@index([organizationId, kind])
  @@index([organizationId, checksum])
  @@index([organizationId, status])
}

model MediaProcessingJob {
  id           String         @id @default(cuid())
  mediaAssetId String         @unique
  status       MediaJobStatus @default(PENDING)
  attempts     Int            @default(0)
  lastError    String?
  createdAt    DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime       @updatedAt @db.Timestamptz(3)
  @@index([status, createdAt])
}
```

Add back-relations to `Organization` (`mediaFolders MediaFolder[]`, `mediaAssets MediaAsset[]`), to `User` (`uploadedMedia MediaAsset[] @relation("MediaUploader")`), and to `Picture` / `Video`:
```prisma
  mediaAssetId String?
  mediaAsset   MediaAsset? @relation(fields: [mediaAssetId], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: `npx prisma migrate dev --create-only --name media_library`**, then append the RLS block to the generated `migration.sql`:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MediaFolder','MediaAsset']
  LOOP
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

`npm run db:migrate`.

- [ ] **Step 4: update the three tenant-table lists.**
- `src/lib/db/tenant.ts` `TENANT_MODELS`: add `"mediaFolder"`, `"mediaAsset"` (Prisma delegate names).
- `src/test/isolation/rls.test.ts` `TENANT_TABLES`: add `"MediaFolder"`, `"MediaAsset"`.
- Create `src/lib/db/tenant-model-list.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TENANT_MODELS } from "@/lib/db/tenant";

function migrationArray(): string[] {
  // the *_rls migration that added the last table set is the source of truth
  const files = readFileSync("prisma/migrations/20260830032500_rls_empty_guc_is_unscoped/migration.sql", "utf8");
  const later = readFileSync(latestMediaMigration(), "utf8");
  const grab = (sql: string) => [...sql.matchAll(/ARRAY\[([^\]]+)\]/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().replace(/'/g, "")));
  return [...new Set([...grab(files), ...grab(later)])];
}
function latestMediaMigration(): string {
  const { readdirSync } = require("node:fs");
  const d = readdirSync("prisma/migrations").filter((x: string) => x.includes("media_library"))[0];
  return `prisma/migrations/${d}/migration.sql`;
}
const toModel = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

describe("tenant table lists agree", () => {
  it("TENANT_MODELS matches the union of RLS migration ARRAYs", () => {
    const fromSql = new Set(migrationArray().map(toModel));
    const fromModels = new Set(TENANT_MODELS as readonly string[]);
    expect([...fromModels].filter((m) => !fromSql.has(m))).toEqual([]);
    expect([...fromSql].filter((m) => !fromModels.has(m))).toEqual([]);
  });
});
```

- [ ] **Step 5: extend `src/test/isolation/rls.test.ts`** — its data-driven "every tenant table has RLS" check already iterates `TENANT_TABLES`, so adding the two names is enough; confirm the run covers `MediaFolder`/`MediaAsset`.

- [ ] **Step 6: run `npm run test`** — media-schema (4), tenant-model-list (1), rls (extended) all green; full suite green; `npm run typecheck` clean.

- [ ] **Step 7: commit**

```bash
git add -A && git commit -m "feat: MediaFolder, MediaAsset, MediaProcessingJob schema with RLS"
```

---

## Task 3: RBAC actions, nav gate, media helpers

**Files:**
- Modify: `src/lib/rbac/policy.ts`, `src/lib/rbac/can.test.ts`
- Modify: `src/lib/nav.ts`, `src/lib/nav.test.ts`
- Create: `src/lib/media/mime.ts`, `src/lib/media/mime.test.ts`, `src/lib/media/web-url.ts`, `src/lib/media/web-url.test.ts`

**Interfaces:**
- Produces:
  - `Action` union gains `"media.view" | "media.create" | "media.update" | "media.delete" | "media.folder.manage"`; `POLICY` rows per the spec §7 table.
  - `NAV_ITEMS` `/media` entry gains `action: "media.view"`.
  - `classifyKind(mimeType: string): "IMAGE" | "VIDEO" | null`
  - `MEDIA_MAX_BYTES: { IMAGE: number; VIDEO: number }` (25 MiB, 500 MiB)
  - `extForMime(mimeType: string): string` (`".jpg" | ".png" | ".webp" | ".gif" | ".mp4" | ".webm"`)
  - `deriveName(filename: string): string` (basename without extension, trimmed, fallback `"Untitled"`)
  - `validateWebUrl(raw: string): { ok: true; url: string } | { ok: false; error: string }` (parse, protocol in http/https, reject embedded credentials)

- [ ] **Step 1: `src/lib/media/mime.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { classifyKind, extForMime, deriveName, MEDIA_MAX_BYTES } from "@/lib/media/mime";
describe("mime helpers", () => {
  it("classifies the allowlist", () => {
    expect(classifyKind("image/png")).toBe("IMAGE");
    expect(classifyKind("video/mp4")).toBe("VIDEO");
    expect(classifyKind("application/pdf")).toBeNull();
    expect(classifyKind("image/svg+xml")).toBeNull();
  });
  it("maps mime to extension", () => {
    expect(extForMime("image/jpeg")).toBe(".jpg");
    expect(extForMime("video/webm")).toBe(".webm");
  });
  it("derives a display name", () => {
    expect(deriveName("Fall Promo 2026.final.PNG")).toBe("Fall Promo 2026.final");
    expect(deriveName("")).toBe("Untitled");
  });
  it("caps: image < video", () => {
    expect(MEDIA_MAX_BYTES.IMAGE).toBe(25 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES.VIDEO).toBe(500 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: run -> FAIL. Implement `src/lib/media/mime.ts`.**

- [ ] **Step 3: `src/lib/media/web-url.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateWebUrl } from "@/lib/media/web-url";
describe("validateWebUrl", () => {
  it("accepts http and https", () => {
    expect(validateWebUrl("https://example.com/menu")).toEqual({ ok: true, url: "https://example.com/menu" });
  });
  it("rejects other schemes and credentials", () => {
    expect(validateWebUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateWebUrl("data:text/html,x").ok).toBe(false);
    expect(validateWebUrl("https://user:pass@example.com").ok).toBe(false);
    expect(validateWebUrl("not a url").ok).toBe(false);
  });
});
```

- [ ] **Step 4: run -> FAIL. Implement `src/lib/media/web-url.ts`.**

- [ ] **Step 5: RBAC + nav.** Add the five actions to `Action` and `POLICY` (`media.view` -> `ALL`; `media.create`/`media.update`/`media.folder.manage` -> `CONTENT_UP`; `media.delete` -> `MANAGERS_UP`). Add to `can.test.ts`: `CONTENT_MANAGER` can `media.create` but not `media.delete`; `VIEWER` can `media.view` only. `nav.ts`: `/media` item `action: "media.view"`. `nav.test.ts`: a roleless actor does not see `/media`; a `VIEWER` does.

- [ ] **Step 6: run `npm run test` (targeted then full), `typecheck`, `lint`** -> all green.

- [ ] **Step 7: commit**

```bash
git add -A && git commit -m "feat: media RBAC actions, nav gate, and mime/url helpers"
```

---

## Task 4: Real storage usage + `assertCanAddStorage`

**Files:**
- Modify: `src/lib/plan-limits/index.ts`, `src/lib/plan-limits/plan-limits.test.ts`

**Interfaces:**
- Consumes: `prisma` (root), `MediaAsset`.
- Produces:
  - `getStorageUsage(organizationId)` -> `{ usedBytes: bigint; limitBytes: bigint | null }` where `usedBytes` = `prisma.mediaAsset.aggregate({ _sum: { sizeBytes }, where: { organizationId, archivedAt: null, status: { in: ["READY","UPLOADING"] } } })._sum.sizeBytes ?? 0n`.
  - `assertCanAddStorage(organizationId: string, addBytes: bigint): Promise<void>` -> throws `PlanLimitError("Your plan includes <N> of storage. Free up space or upgrade to add more.")` when `limitBytes != null && used + addBytes > limitBytes`. Include a `formatBytes`-style human size in the message (a local helper is fine; do not import the dashboard one to avoid a cycle).
  - `getUsageSummary` unchanged in shape; its `storage` block now carries the real number.

- [ ] **Step 1: extend `plan-limits.test.ts`**

```ts
it("getStorageUsage sums READY and UPLOADING non-archived assets", async () => {
  const org = await orgOnPlan(PlanKey.STARTER); // maxStorageBytes 10 GiB
  const f = { organizationId: org.id, kind: "IMAGE" as const, name: "x" };
  await prisma.mediaAsset.createMany({ data: [
    { ...f, status: "READY", sizeBytes: BigInt(3_000_000) },
    { ...f, status: "UPLOADING", sizeBytes: BigInt(1_000_000) },
    { ...f, status: "FAILED", sizeBytes: BigInt(9_000_000) },
    { ...f, status: "READY", sizeBytes: BigInt(5_000_000), archivedAt: new Date() },
  ] });
  const u = await getStorageUsage(org.id);
  expect(u.usedBytes).toBe(BigInt(4_000_000));
});
it("assertCanAddStorage throws past the limit and is unlimited on ENTERPRISE", async () => {
  const trial = await orgOnPlan(PlanKey.TRIAL); // 1 GiB
  await prisma.mediaAsset.create({ data: { organizationId: trial.id, kind: "VIDEO", name: "v", status: "READY", sizeBytes: BigInt(1_000_000_000) } });
  await expect(assertCanAddStorage(trial.id, BigInt(200_000_000))).rejects.toThrow(/storage/i);
  const ent = await orgOnPlan(PlanKey.ENTERPRISE);
  await expect(assertCanAddStorage(ent.id, BigInt(9_999_999_999))).resolves.toBeUndefined();
});
```

- [ ] **Step 2: run -> FAIL. Implement.** `_sum.sizeBytes` is `bigint | null` — coalesce. Keep everything in the bigint domain (no `Number()`), format the message size with a small inline `humanBytes(bigint)`.

- [ ] **Step 3: run full `npm run test`, `typecheck`, `lint`** — green. The dashboard storage tile + billing bar now show real numbers with no change to those files; spot-check the dashboard test still passes.

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "feat: real media storage usage and plan enforcement"
```

---

## Task 5: Upload actions + presigned-GET route

**Files:**
- Create: `src/app/(app)/media/actions.ts` (partial: `requestUpload`, `finalizeUpload`)
- Create: `src/app/api/media/[id]/url/route.ts`
- Modify: `eslint.config.mjs` (allow `@/lib/db/root` in `src/app/api/media/[id]/url/route.ts` if it needs the root client; prefer `requireRole` context instead)
- Test: `src/app/(app)/media/media.test.ts` (partial)

**Interfaces:**
- Consumes: `requireRole` (`@/lib/auth/context`), `storage` + key builders (`@/lib/storage`), `classifyKind`/`extForMime`/`deriveName`/`MEDIA_MAX_BYTES` (`@/lib/media/mime`), `assertCanAddStorage` (`@/lib/plan-limits`), `writeAudit` (`@/lib/audit`), `PlanLimitError`/`ValidationError`/`NotFoundError` (`@/lib/errors`), `sharp`, `createHash` (`node:crypto`).
- Produces:
  - `requestUpload(input: { folderId?: string; filename: string; mimeType: string; sizeBytes: number }): Promise<{ assetId: string; upload: UploadTarget } | { error: string }>` — `requireRole("media.create")`; `classifyKind` -> `kind` or `{ error: "That file type is not supported." }`; `sizeBytes > MEDIA_MAX_BYTES[kind]` -> `{ error }`; if `folderId`, `ctx.db.mediaFolder.findUnique` must resolve -> else `{ error }`; `await assertCanAddStorage(ctx.organizationId, BigInt(sizeBytes))` (catch `PlanLimitError` -> `{ error: e.userMessage }`); `const asset = await ctx.db.mediaAsset.create({ data: { folderId, kind, status: "UPLOADING", name: deriveName(filename), originalFilename: filename, mimeType, sizeBytes: BigInt(sizeBytes), createdByUserId: ctx.user.id } })`; `const key = assetStorageKey(ctx.organizationId, asset.id, extForMime(mimeType))`; `await ctx.db.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } })`; `const upload = await storage.createUploadUrl(key, mimeType, MEDIA_MAX_BYTES[kind])`; `writeAudit({ organizationId, actorType:"USER", actorId:ctx.user.id, action:"media.upload.request", targetType:"MediaAsset", targetId: asset.id })`; return `{ assetId: asset.id, upload }`.
  - `finalizeUpload(assetId: string): Promise<{ status: "READY" | "FAILED"; duplicateOf?: string }>` — `requireRole("media.create")`; `const asset = await ctx.db.mediaAsset.findUnique({ where: { id: assetId } })`; `!asset || asset.status !== "UPLOADING"` -> `NotFoundError`; `const head = await storage.headObject(asset.storageKey!)`; if `!head || head.sizeBytes !== Number(asset.sizeBytes) || (head.contentType && head.contentType !== asset.mimeType)` -> `ctx.db.mediaAsset.update({ status: "FAILED" })` + return `{ status: "FAILED" }`; stream `getObjectStream`, feed a `createHash("sha256")` AND (for IMAGE) a `sharp` pipeline; IMAGE: `const meta = await sharp(buf).metadata()`; `const thumb = await sharp(buf).resize(480, 480, { fit: "inside" }).webp().toBuffer()`; `await storage.putObject(assetThumbKey(org, assetId), thumb, "image/webp")`; set `width`, `height`, `thumbnailKey`; VIDEO: `await prisma.mediaProcessingJob.create({ data: { mediaAssetId: assetId } })` (root client — MediaProcessingJob is global; add the eslint allow-list line for this file with reason "MediaProcessingJob is a global queue table"); set `checksum`; `const dup = await ctx.db.mediaAsset.findFirst({ where: { checksum, archivedAt: null, status: "READY", id: { not: assetId } } })`; `ctx.db.mediaAsset.update({ status: "READY", checksum, width, height, thumbnailKey })`; `writeAudit(action:"media.upload")`; return `{ status: "READY", duplicateOf: dup?.id }`.
  - `GET /api/media/[id]/url` -> resolves `requireRole("media.view")`, `ctx.db.mediaAsset.findUnique`, `!asset || asset.archivedAt` -> 404 `toProblem`; `asset.kind === "WEB"` -> `{ url: asset.url }`; else `{ url: await storage.createDownloadUrl(asset.storageKey!, 3600), thumbnailUrl: asset.thumbnailKey ? await storage.createDownloadUrl(asset.thumbnailKey, 3600) : null }`.

- [ ] **Step 1: `src/app/(app)/media/media.test.ts`** — mock `@/lib/auth/context` (fixed ctx with a real `organizationId` + `ctx.db = forOrg(orgId)`), mock `@/lib/storage` with an in-memory fake (`Map<string, Buffer>` backing `putObject`/`headObject`/`getObjectStream`/`deletePrefix`, `createUploadUrl` returns a dummy target), mock `next/cache`. Cases:
  - `requestUpload` with `image/png` under cap -> `{ assetId, upload }`, a `MediaAsset` row exists `status UPLOADING` with `storageKey` set and `organizationId` = the active org.
  - `requestUpload` with `application/pdf` -> `{ error: /not supported/ }`, no row.
  - `requestUpload` over the image cap -> `{ error }`.
  - `requestUpload` at the plan storage limit -> `{ error: /storage/ }`.
  - `finalizeUpload` happy image: pre-seed the fake store with the object at the expected key + size, run -> `{ status: "READY" }`, row has `width`/`height`/`thumbnailKey`/`checksum`, a thumb object exists.
  - `finalizeUpload` with no object in the store -> `{ status: "FAILED" }`, row `FAILED`.
  - `finalizeUpload` size mismatch -> `{ status: "FAILED" }`.
  - `finalizeUpload` duplicate checksum -> `{ status: "READY", duplicateOf }`.

- [ ] **Step 2: run -> FAIL. Implement `requestUpload` + `finalizeUpload` + the route.** Use a real 1x1 PNG buffer in the test for the sharp path.

- [ ] **Step 3: run targeted -> GREEN. Full `npm run test` (needs `db:up`; storage is mocked here so `storage:up` not required for this file), `typecheck`, `lint` (the eslint allow-list entry must keep lint clean), `build`.**

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "feat: presigned media upload request and finalize actions"
```

---

## Task 6: Folder / web-content / asset-mutation actions

**Files:**
- Modify: `src/app/(app)/media/actions.ts` (append)
- Modify: `src/app/(app)/media/media.test.ts` (append)

**Interfaces:**
- Produces (all `"use server"`, all `requireRole` then `writeAudit` then `revalidatePath("/media")`):
  - `createFolder(input: { name: string; parentId?: string }): Promise<{ id?: string; error?: string }>` — `media.folder.manage`; `parentId` (if set) must be same-org; unique-name conflict -> `{ error: "A folder with that name already exists here." }` (catch P2002).
  - `renameFolder(id: string, name: string)` / `moveFolder(id: string, parentId: string | null)` — `media.folder.manage`; `moveFolder` rejects a cycle (target is not `id` or a descendant of `id`).
  - `deleteFolder(id: string): Promise<{ error?: string }>` — `media.folder.manage`; `ctx.db.mediaFolder.delete` (schema `onDelete` reparents assets + cascades child folders); audit `media.folder.delete`.
  - `createWebContent(input: { name: string; url: string }): Promise<{ id?: string; error?: string }>` — `media.create`; `validateWebUrl` -> `{ error }` on fail; `ctx.db.mediaAsset.create({ data: { kind: "WEB", status: "READY", name, url, createdByUserId } })`; audit `media.web.create`.
  - `updateAsset(id: string, patch: { name?: string; tags?: string[]; folderId?: string | null }): Promise<{ error?: string }>` — `media.update`; `folderId` (if set) same-org; `tags` trimmed, deduped, max 20, each <= 40 chars; audit `media.update`.
  - `deleteAssets(ids: string[]): Promise<{ archived: number; error?: string }>` — `media.delete`; for each id in the org: set `archivedAt = new Date()` (soft delete always; object purge is the worker's job); audit `media.delete` with `{ count }`. Returns `{ archived }`.
  - `restoreAsset(id: string): Promise<{ error?: string }>` — `media.update`; only if `archivedAt` set and (for non-WEB) `storage.headObject(storageKey)` still resolves; clear `archivedAt`; audit `media.restore`.

- [ ] **Step 1: append tests** — folder create / rename / move (+ cycle rejection) / delete (asset in it ends up `folderId: null`, not deleted); `createWebContent` valid + invalid URL; `updateAsset` tags normalization + cross-org `folderId` rejected; `deleteAssets` on a referenced asset (create a `Picture` with `mediaAssetId`) -> `archivedAt` set, `Picture.mediaAssetId` unchanged; `deleteAssets` on an unreferenced asset -> `archivedAt` set; `restoreAsset` clears it.

- [ ] **Step 2: run -> FAIL. Implement.**

- [ ] **Step 3: run -> GREEN. Full suite, typecheck, lint, build.**

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "feat: media folder, web-content, and asset mutation actions"
```

---

## Task 7: Worker jobs

**Files:**
- Create: `src/worker/jobs/processMediaAsset.ts`, `src/worker/jobs/sweepStuckUploads.ts`, `src/worker/jobs/purgeArchivedMedia.ts`
- Modify: `src/worker/index.ts`
- Modify: `eslint.config.mjs` (allow-list the 3 job files for `@/lib/db/root` if not already covered by a `src/worker/**` glob — check; the Foundation added `src/worker/jobs/**`)
- Test: `src/worker/jobs/media.test.ts`

**Interfaces:**
- Consumes: `prisma` (root), `storage`, `logger`, `writeAudit`, `sharp`.
- Produces:
  - `processMediaAsset(): Promise<{ done: number; failed: number }>` — batch of up to 10 `MediaProcessingJob` `status in (PENDING, FAILED)` and `attempts < 5`, oldest first. For each: load the `MediaAsset`; if archived or missing -> mark job `DONE` and skip. Try `ffprobe` (spawn `ffprobe -v quiet -print_format json -show_format -show_streams <presigned GET url>`); on success set `durationSeconds` (rounded) + `width`/`height` if absent; generate a poster via `ffmpeg -ss 1 -i <url> -frames:v 1 -f image2pipe -vcodec png -` piped into `sharp().resize(480).webp()` -> `storage.putObject(assetThumbKey, ...)` -> set `thumbnailKey`. If `ffprobe`/`ffmpeg` not found (`ENOENT`): leave `durationSeconds` null, set `thumbnailKey` to a shared `system/video-placeholder.webp` key (uploaded once by the job on first miss via `putObject` of a small bundled asset, or just leave `thumbnailKey` null and let the card show a glyph — pick the glyph; simpler). Mark job `DONE`. On any thrown error: `attempts++`, `lastError`, `status` stays retryable until `attempts >= 5` then `FAILED`.
  - `sweepStuckUploads(now = new Date()): Promise<{ failed: number }>` — `MediaAsset` where `status = "UPLOADING"` and `createdAt < now - 1h`; for each: `storage.deletePrefix(\`org/${organizationId}/${id}/\`)`, set `status = "FAILED"`. Per-org `writeAudit({ actorType:"SYSTEM", action:"media.upload.expired", targetType:"MediaAsset", metadata:{ count } })`. Return `{ failed }`.
  - `purgeArchivedMedia(now = new Date()): Promise<{ purged: number }>` — `MediaAsset` where `archivedAt < now - 7d`; for each, if `picture.count({ where: { mediaAssetId: id } }) + video.count(...) === 0`: `storage.deletePrefix`, `prisma.mediaAsset.delete`. Per-org `writeAudit({ actorType:"SYSTEM", action:"media.purged", metadata:{ count } })`. Return `{ purged }`.
  - `src/worker/index.ts`: `processMediaAsset` every 20s, `sweepStuckUploads` every 300s, `purgeArchivedMedia` every 900s; each wrapped in the existing try/catch-and-continue guard with its own reentrancy flag.

- [ ] **Step 1: `src/worker/jobs/media.test.ts`** (real DB, fake/mock `storage`):
  - `sweepStuckUploads`: a `MediaAsset` `UPLOADING` `createdAt` 2h ago -> `FAILED`, `storage.deletePrefix` called with its prefix; a fresh `UPLOADING` untouched.
  - `purgeArchivedMedia`: an archived (8d) unreferenced asset -> row deleted, `deletePrefix` called; an archived asset still referenced by a `Picture` -> row kept; a recently archived (1d) asset -> kept.
  - `processMediaAsset`: seed a `MediaProcessingJob` + `MediaAsset` VIDEO; with `ffprobe` absent (spawn stubbed to `ENOENT`) -> job `DONE`, no throw; asset `durationSeconds` still null.

- [ ] **Step 2: run -> FAIL. Implement the three jobs + wire the intervals.** Keep the `ffprobe` spawn behind a `which`/`ENOENT` guard so the absence path is clean.

- [ ] **Step 3: run -> GREEN. `npm run worker:dev` for ~10s to confirm it starts and the three intervals log, then SIGINT. Full suite, typecheck, lint, build.**

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "feat: worker jobs for media processing, stuck-upload sweep, and archived purge"
```

---

## Task 8: Media library page + components

**Files:**
- Modify: `src/app/(app)/media/page.tsx` (replace `ComingSoon`)
- Create: `src/components/app/media/{media-library,media-toolbar,media-card,media-preview-dialog,folder-crumbs,move-to-folder-dialog,tag-editor,upload-queue,storage-bar,new-folder-dialog,add-web-content-dialog}.tsx`
- Create: `src/components/app/media/media-card.test.tsx`, `src/components/app/media/storage-bar.test.tsx`

**Interfaces:**
- Consumes: `requireRole("media.view")`, `ctx.db` (facade), `getStorageUsage`, the actions from Tasks 5-6, the `/api/media/[id]/url` route, `ui/*`, existing app components (`PageHeader`, `EmptyState`, `Dialog`, `DropdownMenu`, `Badge`, `Button`, `Input`).
- Produces:
  - `page.tsx` (server): `const ctx = await requireRole("media.view")`; parse `searchParams` `{ folder?, q?, kind?, sort?, page? }`; in ONE `withOrgTransaction` load: the current folder (or null = root) + its ancestor chain for the breadcrumb, the child `MediaFolder`s of the current folder, and a page (24) of `MediaAsset` (`archivedAt: null`, `folderId` = current, `kind` filter, `name`/`tags` `q` filter via `OR: [{ name: { contains: q, mode: "insensitive" } }, { tags: { has: q } }]`, `orderBy` from `sort`); plus `getStorageUsage(ctx.organizationId)`. Render `<PageHeader title="Media" ...>` + `<StorageBar used={} limit={} />` + `<MediaLibrary ...serializable props... canManageFolders={can(ctx.actor,"media.folder.manage")} canDelete={can(ctx.actor,"media.delete")} canCreate={can(ctx.actor,"media.create")} />`. All `render`-closures live in the client components (Foundation RSC lesson).
  - `MediaLibrary` (`"use client"`): drag-drop zone over the grid, upload queue state, renders toolbar + folder cards + asset grid + bulk bar. Drop/file-pick -> for each file: `requestUpload` -> `XMLHttpRequest` PUT to `upload.url` with `upload.headers` and `onprogress` -> `finalizeUpload` -> refresh (`router.refresh()`), toast on `duplicateOf` ("Looks like a copy of an existing asset").
  - `MediaCard`: thumbnail via `<img src={thumbnailUrl}>` (fetched from the url route on mount, or passed if the page pre-signs a first-page batch), kind `Badge`, `humanBytes(sizeBytes)`, a "Used in N" chip when `_count` of pictures+videos > 0, selection checkbox, `DropdownMenu` (Preview / Rename / Move / Tags / Delete gated by `canDelete`).
  - `StorageBar`: `used`/`limit` bigint-as-string props; bar width `Number(used*100n/limit)`%; amber when >= 80%, red when >= 100; "Unlimited" when `limit` null; a "Manage storage" link to `/billing`.
  - `MediaPreviewDialog`: `<img>` / `<video controls>` / sandboxed `<iframe>` by kind; metadata list.
  - The three dialogs call `createFolder` / `createWebContent` / `moveFolder` and `router.refresh()`.

- [ ] **Step 1: `media-card.test.tsx`** (jsdom): renders name, kind badge text ("Image"/"Video"/"Web"), `humanBytes` output, a "Used in 2" chip when `usedCount={2}`, no chip when `0`; delete item absent when `canDelete={false}`.

- [ ] **Step 2: `storage-bar.test.tsx`** (jsdom): `used="9000000000" limit="10000000000"` -> shows "90%" region and the amber class; `limit={null}` -> "Unlimited", no bar; `used > limit` -> red + "over".

- [ ] **Step 3: run -> FAIL. Implement all components + the page.** Keep the page server-only; every function prop crosses into a `"use client"` component, never into a shared primitive.

- [ ] **Step 4: run -> GREEN. Full `npm run test`, `typecheck`, `lint`, `build`. `npm run dev` + `npm run storage:up`: visit `/media`, drag an image, confirm a card with a thumbnail, create a folder, move it, add a tag, filter, preview, delete, watch the storage bar move; add a web-content URL.**

- [ ] **Step 5: commit**

```bash
git add -A && git commit -m "feat: media library page and components"
```

---

## Task 9: Tenant-isolation suite extension

**Files:**
- Modify: `src/test/isolation/tenant-isolation.spec.ts`

**Interfaces:**
- Consumes: the media actions, `forOrg`, `withOrgTransaction`.
- Produces: new cases in the vitest isolation spec. With org B holding a `MediaFolder` and a `MediaAsset`, and the auth context mocked to user A:
  - `forOrg(A).mediaAsset.findMany()` and `.mediaFolder.findMany()` never contain B's rows; `findUnique({ where: { id: bAssetId } })` is `null`.
  - `updateAsset(bAssetId, { name })`, `deleteAssets([bAssetId])`, `restoreAsset(bAssetId)`, `renameFolder(bFolderId, "x")`, `moveFolder(bFolderId, null)`, `deleteFolder(bFolderId)`, `requestUpload({ folderId: bFolderId, ... })` each return `{ error }` / throw and leave B's rows byte-unchanged (deep-equal a before/after re-read; B asset count unchanged).
  - `withOrgTransaction(A.id, tx => tx.$queryRawUnsafe('SELECT id FROM "MediaAsset"'))` returns none of B's ids.

- [ ] **Step 1: add the cases.** Reuse the spec's existing org-A / org-B fixture setup; extend `beforeEach` seeding with a B folder + B asset.

- [ ] **Step 2: run `npm run test -- src/test/isolation/tenant-isolation.spec.ts`** -> GREEN. Full suite green.

- [ ] **Step 3: commit**

```bash
git add -A && git commit -m "test: tenant isolation for media assets and folders"
```

---

## Task 10: E2E media journey

**Files:**
- Create: `src/test/e2e/media.spec.ts`
- Modify: `playwright.config.ts` (`webServer.env` gains the `STORAGE_*` values pointing at the test MinIO; `pretest:e2e` / the harness ensures `storage:up`)
- Modify: `package.json` (`pretest:e2e` also runs `npm run storage:up`)

**Interfaces:**
- Consumes: the built app + local MinIO + `lynesign_test` DB.
- Produces: `media.spec.ts` — `beforeAll` resets the DB, seeds plans, ensures the test bucket. Flow: register -> `/media` (empty state) -> set an `<input type=file>` to a fixture PNG (`src/test/fixtures/sample.png`, add it) -> wait for the card + its thumbnail `<img>` to load -> "New folder" "Promos" -> move the asset into it via its menu -> open the asset, add tag "fall", close -> filter by kind = Images and by search "fall" -> asset still shown -> open preview, assert the `<img>` renders -> delete the asset -> grid empty, storage bar back to a low value -> "Add web content" with `https://example.com` -> a WEB card appears.

- [ ] **Step 1: add `src/test/fixtures/sample.png`** (a small real PNG committed as a binary).

- [ ] **Step 2: write `media.spec.ts`; wire `playwright.config.ts` + `pretest:e2e`.**

- [ ] **Step 3: `npm run storage:up && npm run test:e2e`** -> the media spec passes (plus the existing specs still green). If MinIO cannot run in the e2e environment, mark the spec `test.skip` with a reason and note it (mirrors the Foundation's Playwright-binary caveat).

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "test: end-to-end media library journey"
```

---

## Task 11: CI + docs

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/architecture.md`, `README.md`

**Interfaces:**
- Produces:
  - `ci.yml`: a `minio` service container (`minio/minio` won't run as a plain GHA service since it needs a command; instead add a step `docker run -d -p 9000:9000 -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD minio/minio server /data` OR use `nixos/minio`/`bitnami/minio` which accept env-only; simplest reliable: a step that `curl`s the MinIO binary like `dev-storage.mjs` and runs it in the background, then creates the bucket with the AWS CLI or a tiny node one-liner). Add `STORAGE_*` to the job env pointing at `http://localhost:9000`. The storage + integration + e2e steps run after MinIO is healthy.
  - `docs/architecture.md`: a "Media" section — the two models + `MediaProcessingJob`, the `StorageProvider` abstraction and the `org/<id>/<assetId>/` key scheme, the presigned direct-upload flow, the `media.*` policy rows, `getStorageUsage` now real, the three worker jobs, and the deferred CDN hook (`STORAGE_PUBLIC_URL`). Add `STORAGE_*` to the env-vars table. Note the local-MinIO-binary harness (no Docker) alongside the embedded-postgres note.
  - `README.md`: local setup gains an optional "Working on Media" step: `npm run storage:up` (downloads + runs MinIO on :9000). Testing section notes the media integration/e2e suites need it.

- [ ] **Step 1: write `ci.yml` MinIO bring-up + env; validate YAML parses (`node -e "require('js-yaml')..."`).**

- [ ] **Step 2: write the docs sections; grep every path/script/env name cited to confirm it exists.**

- [ ] **Step 3: full local gate: `npm run db:up && npm run storage:up && npm run lint && npm run typecheck && npm run test && npm run test:e2e`** -> all green.

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "docs: CI MinIO service and Media architecture section"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 4.1 MediaFolder | 2 |
| 4.2 MediaAsset + enums | 2 |
| 4.3 Picture/Video.mediaAssetId | 2 |
| 4.4 RLS + 3-list sync + equality test | 2 |
| 5 StorageProvider + S3 + MinIO + env | 1 |
| 6 requestUpload / finalizeUpload / download route | 5 |
| 6 folder / web / update / delete / restore actions | 6 |
| 7 RBAC media.* + nav gate | 3 |
| 8.1 real getStorageUsage + assertCanAddStorage | 4 |
| 8.2 MediaProcessingJob + 3 worker jobs | 2 (model), 7 (jobs) |
| 9 library page + components | 8 |
| 10 security (key derivation, MIME re-check, signed-URL TTLs, iframe sandbox) | 1 (keys), 3 (mime/url), 5 (re-check + TTL), 8 (sandbox) |
| 11 unit / integration | per task |
| 11 isolation | 9 |
| 11 e2e | 10 |
| 11 CI + docs | 11 |
| 13 env vars | 1 (.env.example), 11 (documented) |
| 14 risk: sharp on runner | 1, 11 (CI first run) |
| 14 risk: ffprobe optional | 7 (ENOENT path + test) |
| 14 risk: MinIO in unit tests | 1 (mock; Step 9 skip-guard) |
| 14 risk: forOrg per-op tx | 8 (page uses one withOrgTransaction) |
| 14 risk: checksum streams the object | accepted in-cluster; noted in 5 |

**Placeholder scan** — no `TBD`/`TODO`/"handle errors"/"similar to Task N". The `ci.yml` MinIO bring-up in Task 11 lists three concrete options and picks "download the binary + run in background + create bucket" as the reliable one; that is a decision, not a placeholder. Task 7's video-thumbnail-on-`ffprobe`-absence resolves to "leave `thumbnailKey` null, card shows a glyph" (explicit choice).

**Type consistency** — `StorageProvider` method names and `UploadTarget` shape are defined in Task 1 and consumed unchanged in Tasks 5, 7, 8. `classifyKind` returns `"IMAGE" | "VIDEO" | null` in Task 3 and is used that way in Task 5. `getStorageUsage` return shape (`{ usedBytes: bigint; limitBytes: bigint | null }`) is unchanged from the Foundation; Task 4 only changes the value. `assertCanAddStorage(orgId, bigint)` signature is fixed in Task 4 and called in Task 5. `assetStorageKey(orgId, assetId, ext)` / `assetThumbKey(orgId, assetId)` are defined in Task 1 and used in Tasks 5 and 7. The `media.*` `Action` strings are identical across Tasks 3, 5, 6, 8, 9. `MediaProcessingJob` delegate name (`mediaProcessingJob`) is used in Tasks 5 and 7.
