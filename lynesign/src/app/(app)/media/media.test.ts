import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { extForMime, MEDIA_MAX_BYTES } from "@/lib/media/mime";
import { PlanLimitError } from "@/lib/errors";

// `@/lib/storage` is mocked below; import the real key builders lazily so the
// mock factory (which closes over module-scope `storageMock`) does not run
// before that variable is initialised.
async function storageMod() {
  return import("@/lib/storage");
}
async function keyFor(orgId: string, assetId: string, mimeType: string) {
  const { assetStorageKey } = await storageMod();
  return assetStorageKey(orgId, assetId, extForMime(mimeType));
}
async function thumbKeyFor(orgId: string, assetId: string) {
  const { assetThumbKey } = await storageMod();
  return assetThumbKey(orgId, assetId);
}

// A real 1x1 transparent PNG. Used for the sharp metadata + thumbnail path.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_SHA256 = createHash("sha256").update(PNG_1x1).digest("hex");

const ctx: {
  user: { id: string; email: string; isSuperAdmin: boolean };
  organizationId: string;
  role: "MANAGER";
  actor: never;
  db: ReturnType<typeof forOrg>;
} = {
  user: { id: "", email: "", isSuperAdmin: false },
  organizationId: "",
  role: "MANAGER",
  actor: {} as never,
  db: {} as never,
};

vi.mock("@/lib/auth/context", () => ({
  requireRole: async () => ctx,
  requireOrg: async () => ctx,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Plan enforcement is exercised by its own suite; here it is a toggle.
let storageLimitReached = false;
vi.mock("@/lib/plan-limits", () => ({
  assertCanAddStorage: async () => {
    if (storageLimitReached) {
      throw new PlanLimitError(
        "Your plan includes 1 GB of storage. Free up space or upgrade to add more.",
      );
    }
  },
}));

// In-memory storage fake.
type Stored = { body: Buffer; contentType: string };
const store = new Map<string, Stored>();
const storageMock = {
  createUploadUrl: vi.fn(async (key: string, contentType: string) => ({
    url: `https://storage.test/put/${encodeURIComponent(key)}`,
    headers: { "Content-Type": contentType },
    expiresAt: new Date(Date.now() + 300_000),
  })),
  createDownloadUrl: vi.fn(
    async (key: string) => `https://storage.test/get/${encodeURIComponent(key)}`,
  ),
  putObject: vi.fn(async (key: string, body: Buffer | Uint8Array, contentType: string) => {
    store.set(key, { body: Buffer.from(body), contentType });
  }),
  getObjectStream: vi.fn(async (key: string): Promise<NodeJS.ReadableStream> => {
    const o = store.get(key);
    if (!o) throw new Error(`no such object: ${key}`);
    return Readable.from(o.body);
  }),
  headObject: vi.fn(async (key: string) => {
    const o = store.get(key);
    return o ? { sizeBytes: o.body.length, contentType: o.contentType } : null;
  }),
  deleteObject: vi.fn(async (key: string) => {
    store.delete(key);
  }),
  deletePrefix: vi.fn(async (prefix: string) => {
    for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
  }),
};
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, storage: storageMock };
});

async function makeOrgAndUser(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: prefix, slug: `${prefix}-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `${prefix}-${suffix}@test.local`, name: "Tester" },
  });
  return { org, user };
}

async function bind(prefix: string) {
  const { org, user } = await makeOrgAndUser(prefix);
  ctx.organizationId = org.id;
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.db = forOrg(org.id);
  return { org, user };
}

async function seedUploading(
  orgId: string,
  opts: { sizeBytes: number; mimeType: string; kind: "IMAGE" | "VIDEO" },
) {
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: opts.kind,
      status: "UPLOADING",
      name: "clip",
      originalFilename: `clip${extForMime(opts.mimeType)}`,
      mimeType: opts.mimeType,
      sizeBytes: BigInt(opts.sizeBytes),
    },
  });
  const key = await keyFor(orgId, asset.id, opts.mimeType);
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });
  return { asset, key };
}

beforeEach(() => {
  store.clear();
  storageLimitReached = false;
  vi.clearAllMocks();
});

describe("requestUpload", () => {
  it("creates an UPLOADING asset and returns an upload target for an image under the cap", async () => {
    const { org, user } = await bind("req-ok");
    const { requestUpload } = await import("@/app/(app)/media/actions");

    const res = await requestUpload({
      filename: "Logo.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);
    expect(res.assetId).toBeTruthy();
    expect(res.upload.url).toContain("https://storage.test/put/");

    const row = await prisma.mediaAsset.findUnique({ where: { id: res.assetId } });
    expect(row?.status).toBe("UPLOADING");
    expect(row?.organizationId).toBe(org.id);
    expect(row?.createdByUserId).toBe(user.id);
    expect(row?.storageKey).toBe(await keyFor(org.id, res.assetId, "image/png"));
    expect(row?.name).toBe("Logo");
  });

  it("rejects an unsupported mime type and writes no row", async () => {
    const { org } = await bind("req-pdf");
    const { requestUpload } = await import("@/app/(app)/media/actions");

    const res = await requestUpload({
      filename: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(res).toEqual({ error: expect.stringMatching(/not supported/i) });
    expect(await prisma.mediaAsset.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("rejects a file larger than the image cap and writes no row", async () => {
    const { org } = await bind("req-big");
    const { requestUpload } = await import("@/app/(app)/media/actions");

    const res = await requestUpload({
      filename: "huge.png",
      mimeType: "image/png",
      sizeBytes: MEDIA_MAX_BYTES.IMAGE + 1,
    });

    expect("error" in res).toBe(true);
    expect(await prisma.mediaAsset.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("returns the plan storage message when the org is at its storage limit", async () => {
    const { org } = await bind("req-limit");
    storageLimitReached = true;
    const { requestUpload } = await import("@/app/(app)/media/actions");

    const res = await requestUpload({
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes: 4096,
    });

    expect(res).toEqual({ error: expect.stringMatching(/storage/i) });
    expect(await prisma.mediaAsset.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it.each([
    ["a negative size", -1],
    ["NaN", Number.NaN],
    ["a fractional size", 1.5],
  ])("rejects %s and writes no row", async (_label, sizeBytes) => {
    const { org } = await bind("req-badsize");
    const { requestUpload } = await import("@/app/(app)/media/actions");

    const res = await requestUpload({
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes,
    });

    expect("error" in res).toBe(true);
    expect(await prisma.mediaAsset.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("finalizeUpload", () => {
  it("marks an image READY with dimensions, checksum and a thumbnail object", async () => {
    const { org } = await bind("fin-img");
    const { asset, key } = await seedUploading(org.id, {
      sizeBytes: PNG_1x1.length,
      mimeType: "image/png",
      kind: "IMAGE",
    });
    store.set(key, { body: PNG_1x1, contentType: "image/png" });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await finalizeUpload(asset.id);

    expect(res).toEqual({ status: "READY", duplicateOf: undefined });
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.status).toBe("READY");
    expect(row?.width).toBe(1);
    expect(row?.height).toBe(1);
    expect(row?.checksum).toBe(PNG_SHA256);
    const thumbKey = await thumbKeyFor(org.id, asset.id);
    expect(row?.thumbnailKey).toBe(thumbKey);
    expect(store.get(thumbKey)?.contentType).toBe("image/webp");
  });

  it("marks the asset FAILED when the object is missing, without deleting", async () => {
    const { org } = await bind("fin-missing");
    const { asset } = await seedUploading(org.id, {
      sizeBytes: 10,
      mimeType: "image/png",
      kind: "IMAGE",
    });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await finalizeUpload(asset.id);

    expect(res).toEqual({ status: "FAILED" });
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.status).toBe("FAILED");
    expect(storageMock.deleteObject).not.toHaveBeenCalled();
    expect(storageMock.deletePrefix).not.toHaveBeenCalled();
  });

  it("deletes the uploaded object and fails on a size mismatch", async () => {
    const { org } = await bind("fin-size");
    const { asset, key } = await seedUploading(org.id, {
      sizeBytes: 999_999,
      mimeType: "image/png",
      kind: "IMAGE",
    });
    store.set(key, { body: PNG_1x1, contentType: "image/png" });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await finalizeUpload(asset.id);

    expect(res).toEqual({ status: "FAILED" });
    const deleted =
      storageMock.deleteObject.mock.calls.length + storageMock.deletePrefix.mock.calls.length;
    expect(deleted).toBeGreaterThan(0);
    expect(store.has(key)).toBe(false);
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.status).toBe("FAILED");
  });

  it("reports duplicateOf when another READY asset has the same checksum", async () => {
    const { org } = await bind("fin-dup");
    const original = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "original",
        mimeType: "image/png",
        sizeBytes: BigInt(PNG_1x1.length),
        checksum: PNG_SHA256,
      },
    });
    const { asset, key } = await seedUploading(org.id, {
      sizeBytes: PNG_1x1.length,
      mimeType: "image/png",
      kind: "IMAGE",
    });
    store.set(key, { body: PNG_1x1, contentType: "image/png" });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await finalizeUpload(asset.id);

    expect(res).toEqual({ status: "READY", duplicateOf: original.id });
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.status).toBe("READY");
  });

  it("marks a video READY and enqueues a PENDING processing job", async () => {
    const { org } = await bind("fin-vid");
    const mp4 = Buffer.from("00000018667479706d70343200000000", "hex");
    const { asset, key } = await seedUploading(org.id, {
      sizeBytes: mp4.length,
      mimeType: "video/mp4",
      kind: "VIDEO",
    });
    store.set(key, { body: mp4, contentType: "video/mp4" });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await finalizeUpload(asset.id);

    expect(res.status).toBe("READY");
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.status).toBe("READY");
    expect(row?.checksum).toBe(createHash("sha256").update(mp4).digest("hex"));
    expect(row?.thumbnailKey).toBeNull();
    const job = await prisma.mediaProcessingJob.findUnique({
      where: { mediaAssetId: asset.id },
    });
    expect(job?.status).toBe("PENDING");
  });

  it("fails and deletes when the object is not a decodable image", async () => {
    const { org } = await bind("fin-notimg");
    const body = Buffer.from("this is plainly not a PNG");
    const { asset, key } = await seedUploading(org.id, {
      sizeBytes: body.length,
      mimeType: "image/png",
      kind: "IMAGE",
    });
    // headObject reports the row's size and a matching content type, so the
    // three head checks pass; sharp then throws on the body.
    store.set(key, { body, contentType: "image/png" });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await finalizeUpload(asset.id);

    expect(res).toEqual({ status: "FAILED" });
    expect(storageMock.deletePrefix).toHaveBeenCalled();
    expect(store.has(key)).toBe(false);
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.status).toBe("FAILED");
  });
});

async function seedReadyImage(
  orgId: string,
  opts: { folderId?: string | null; archived?: boolean; withObject?: boolean } = {},
) {
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      folderId: opts.folderId ?? null,
      kind: "IMAGE",
      status: "READY",
      name: "photo",
      mimeType: "image/png",
      sizeBytes: BigInt(PNG_1x1.length),
      archivedAt: opts.archived ? new Date() : null,
    },
  });
  const key = await keyFor(orgId, asset.id, "image/png");
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });
  if (opts.withObject !== false) store.set(key, { body: PNG_1x1, contentType: "image/png" });
  return { asset, key };
}

// A Picture row needs the whole Canvas -> Panel -> Frame -> Content chain.
async function seedPicture(orgId: string, mediaAssetId: string) {
  const canvas = await prisma.canvas.create({
    data: { organizationId: orgId, name: "c", width: 1920, height: 1080 },
  });
  const panel = await prisma.panel.create({
    data: { organizationId: orgId, canvasId: canvas.id, x: 0, y: 0, width: 100, height: 100 },
  });
  const frame = await prisma.frame.create({
    data: { organizationId: orgId, panelId: panel.id, type: "PICTURE" },
  });
  const content = await prisma.content.create({
    data: { organizationId: orgId, frameId: frame.id },
  });
  return prisma.picture.create({
    data: { contentId: content.id, organizationId: orgId, mediaAssetId },
  });
}

describe("createFolder", () => {
  it("creates a folder and audits it", async () => {
    const { org } = await bind("folder-create");
    const { createFolder } = await import("@/app/(app)/media/actions");

    const res = await createFolder({ name: "Campaigns" });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);
    const row = await prisma.mediaFolder.findUnique({ where: { id: res.id } });
    expect(row?.name).toBe("Campaigns");
    expect(row?.organizationId).toBe(org.id);
    expect(row?.parentId).toBeNull();
  });

  it("rejects a blank name and writes no row", async () => {
    const { org } = await bind("folder-blank");
    const { createFolder } = await import("@/app/(app)/media/actions");

    const res = await createFolder({ name: "  " });

    expect("error" in res && res.error).toBeTruthy();
    expect(await prisma.mediaFolder.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("rejects a duplicate name under the same parent", async () => {
    await bind("folder-dup");
    const { createFolder } = await import("@/app/(app)/media/actions");

    const parent = await createFolder({ name: "Root" });
    if ("error" in parent) throw new Error(parent.error);
    await createFolder({ name: "Shared", parentId: parent.id });
    const res = await createFolder({ name: "Shared", parentId: parent.id });

    expect(res).toEqual({ error: "A folder with that name already exists here." });
  });

  it("rejects a duplicate name at the root (partial unique index)", async () => {
    await bind("folder-dup-root");
    const { createFolder } = await import("@/app/(app)/media/actions");

    await createFolder({ name: "Shared" });
    const res = await createFolder({ name: "Shared" });

    expect(res).toEqual({ error: "A folder with that name already exists here." });
  });

  it("rejects a parentId from another org", async () => {
    const other = await makeOrgAndUser("folder-parent-other");
    const otherFolder = await prisma.mediaFolder.create({
      data: { organizationId: other.org.id, name: "Theirs" },
    });
    await bind("folder-parent");
    const { createFolder } = await import("@/app/(app)/media/actions");

    const res = await createFolder({ name: "Mine", parentId: otherFolder.id });

    expect(res).toEqual({ error: expect.stringMatching(/organization/i) });
  });
});

describe("renameFolder", () => {
  it("renames a folder", async () => {
    await bind("folder-rename");
    const { createFolder, renameFolder } = await import("@/app/(app)/media/actions");
    const created = await createFolder({ name: "Old" });
    if ("error" in created) throw new Error(created.error);

    const res = await renameFolder(created.id!, "New");

    expect(res).toEqual({});
    const row = await prisma.mediaFolder.findUnique({ where: { id: created.id } });
    expect(row?.name).toBe("New");
  });

  it("rejects a name that collides with a sibling", async () => {
    await bind("folder-rename-dup");
    const { createFolder, renameFolder } = await import("@/app/(app)/media/actions");
    const parent = await createFolder({ name: "Root" });
    if ("error" in parent) throw new Error(parent.error);
    await createFolder({ name: "A", parentId: parent.id });
    const b = await createFolder({ name: "B", parentId: parent.id });
    if ("error" in b) throw new Error(b.error);

    const res = await renameFolder(b.id!, "A");

    expect(res).toEqual({ error: "A folder with that name already exists here." });
  });

  it("rejects a name that collides with another root folder", async () => {
    await bind("folder-rename-dup-root");
    const { createFolder, renameFolder } = await import("@/app/(app)/media/actions");
    await createFolder({ name: "A" });
    const b = await createFolder({ name: "B" });
    if ("error" in b) throw new Error(b.error);

    const res = await renameFolder(b.id!, "A");

    expect(res).toEqual({ error: "A folder with that name already exists here." });
  });
});

describe("moveFolder", () => {
  it("reparents a folder", async () => {
    await bind("folder-move");
    const { createFolder, moveFolder } = await import("@/app/(app)/media/actions");
    const parent = await createFolder({ name: "Parent" });
    const child = await createFolder({ name: "Child" });
    if ("error" in parent) throw new Error(parent.error);
    if ("error" in child) throw new Error(child.error);

    const res = await moveFolder(child.id!, parent.id!);

    expect(res).toEqual({});
    const row = await prisma.mediaFolder.findUnique({ where: { id: child.id } });
    expect(row?.parentId).toBe(parent.id);
  });

  it("rejects moving a folder into its own descendant", async () => {
    await bind("folder-move-cycle");
    const { createFolder, moveFolder } = await import("@/app/(app)/media/actions");
    const a = await createFolder({ name: "A" });
    if ("error" in a) throw new Error(a.error);
    const b = await createFolder({ name: "B", parentId: a.id });
    if ("error" in b) throw new Error(b.error);

    const res = await moveFolder(a.id!, b.id!);

    expect(res).toEqual({ error: "You cannot move a folder inside itself." });
    const row = await prisma.mediaFolder.findUnique({ where: { id: a.id } });
    expect(row?.parentId).toBeNull();
  });
});

describe("deleteFolder", () => {
  it("deletes the folder and reparents its assets to null without deleting them", async () => {
    const { org } = await bind("folder-delete");
    const { createFolder, deleteFolder } = await import("@/app/(app)/media/actions");
    const folder = await createFolder({ name: "Doomed" });
    if ("error" in folder) throw new Error(folder.error);
    const { asset } = await seedReadyImage(org.id, { folderId: folder.id });

    const res = await deleteFolder(folder.id!);

    expect(res).toEqual({});
    expect(await prisma.mediaFolder.findUnique({ where: { id: folder.id } })).toBeNull();
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row).not.toBeNull();
    expect(row?.folderId).toBeNull();
  });

  it("returns an error for a folder in another org", async () => {
    const other = await makeOrgAndUser("folder-delete-other");
    const theirs = await prisma.mediaFolder.create({
      data: { organizationId: other.org.id, name: "Theirs" },
    });
    await bind("folder-delete-xorg");
    const { deleteFolder } = await import("@/app/(app)/media/actions");

    const res = await deleteFolder(theirs.id);

    expect(res).toEqual({ error: "That folder no longer exists." });
    expect(await prisma.mediaFolder.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});

describe("createWebContent", () => {
  it("creates a READY WEB asset for a valid url", async () => {
    const { org, user } = await bind("web-ok");
    const { createWebContent } = await import("@/app/(app)/media/actions");

    const res = await createWebContent({ name: "Docs", url: "https://example.com/docs" });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);
    const row = await prisma.mediaAsset.findUnique({ where: { id: res.id } });
    expect(row?.kind).toBe("WEB");
    expect(row?.status).toBe("READY");
    expect(row?.url).toBe("https://example.com/docs");
    expect(row?.organizationId).toBe(org.id);
    expect(row?.createdByUserId).toBe(user.id);
  });

  it("rejects a non-http url and writes no row", async () => {
    const { org } = await bind("web-bad");
    const { createWebContent } = await import("@/app/(app)/media/actions");

    const res = await createWebContent({ name: "Bad", url: "ftp://example.com/x" });

    expect(res).toEqual({ error: expect.stringMatching(/http/i) });
    expect(await prisma.mediaAsset.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("updateAsset", () => {
  it("normalizes tags: trims, drops empties, dedupes preserving order", async () => {
    const { org } = await bind("asset-tags");
    const { asset } = await seedReadyImage(org.id);
    const { updateAsset } = await import("@/app/(app)/media/actions");

    const res = await updateAsset(asset.id, {
      tags: ["  promo ", "promo", "", "  ", "q4", "PROMO"],
    });

    expect(res).toEqual({});
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.tags).toEqual(["promo", "q4", "PROMO"]);
  });

  it("rejects more than 20 tags", async () => {
    const { org } = await bind("asset-tags-many");
    const { asset } = await seedReadyImage(org.id);
    const { updateAsset } = await import("@/app/(app)/media/actions");

    const res = await updateAsset(asset.id, {
      tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
    });

    expect(res).toEqual({
      error: "Tags must be 20 or fewer, each 40 characters or less.",
    });
  });

  it("rejects a folderId from another org and leaves the asset unchanged", async () => {
    const other = await makeOrgAndUser("asset-folder-other");
    const theirFolder = await prisma.mediaFolder.create({
      data: { organizationId: other.org.id, name: "Theirs" },
    });
    const { org } = await bind("asset-folder");
    const { asset } = await seedReadyImage(org.id);
    const { updateAsset } = await import("@/app/(app)/media/actions");

    const res = await updateAsset(asset.id, { folderId: theirFolder.id });

    expect(res).toEqual({ error: expect.stringMatching(/organization/i) });
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.folderId).toBeNull();
  });
});

describe("deleteAssets", () => {
  it("archives an asset referenced by a Picture without touching the Picture link", async () => {
    const { org } = await bind("del-referenced");
    const { asset } = await seedReadyImage(org.id);
    const picture = await seedPicture(org.id, asset.id);
    const { deleteAssets } = await import("@/app/(app)/media/actions");

    const res = await deleteAssets([asset.id]);

    expect(res).toEqual({ archived: 1 });
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.archivedAt).not.toBeNull();
    const pic = await prisma.picture.findUnique({ where: { contentId: picture.contentId } });
    expect(pic?.mediaAssetId).toBe(asset.id);
  });

  it("archives an unreferenced asset and returns the count", async () => {
    const { org } = await bind("del-plain");
    const { asset: a } = await seedReadyImage(org.id);
    const { asset: b } = await seedReadyImage(org.id);
    const { deleteAssets } = await import("@/app/(app)/media/actions");

    const res = await deleteAssets([a.id, b.id]);

    expect(res).toEqual({ archived: 2 });
    for (const id of [a.id, b.id]) {
      const row = await prisma.mediaAsset.findUnique({ where: { id } });
      expect(row?.archivedAt).not.toBeNull();
    }
  });

  it("returns { archived: 0 } for an empty id list", async () => {
    await bind("del-empty");
    const { deleteAssets } = await import("@/app/(app)/media/actions");

    expect(await deleteAssets([])).toEqual({ archived: 0 });
  });
});

describe("restoreAsset", () => {
  it("clears archivedAt when the stored object is still present", async () => {
    const { org } = await bind("restore-ok");
    const { asset } = await seedReadyImage(org.id, { archived: true });
    const { restoreAsset } = await import("@/app/(app)/media/actions");

    const res = await restoreAsset(asset.id);

    expect(res).toEqual({});
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.archivedAt).toBeNull();
  });

  it("refuses to restore when the stored object is gone", async () => {
    const { org } = await bind("restore-gone");
    const { asset } = await seedReadyImage(org.id, { archived: true, withObject: false });
    const { restoreAsset } = await import("@/app/(app)/media/actions");

    const res = await restoreAsset(asset.id);

    expect(res).toEqual({
      error: "The stored file for this item is gone and it cannot be restored.",
    });
    const row = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(row?.archivedAt).not.toBeNull();
  });
});
