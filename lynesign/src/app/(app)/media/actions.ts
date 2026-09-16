"use server";

import { createHash, type Hash } from "node:crypto";

import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/context";
import { prisma } from "@/lib/db/root";
import { validateWebUrl } from "@/lib/media/web-url";
import {
  storage,
  assetStorageKey,
  assetThumbKey,
  assetPrefix,
  type UploadTarget,
} from "@/lib/storage";
import {
  requestUploadSchema,
  createFolderSchema,
  renameFolderSchema,
  createWebContentSchema,
  updateAssetSchema,
  idSchema,
} from "@/lib/validation/media";
import {
  classifyKind,
  extForMime,
  deriveName,
  MEDIA_MAX_BYTES,
} from "@/lib/media/mime";
import { assertCanAddStorage } from "@/lib/plan-limits";
import { writeAudit } from "@/lib/audit";
import { PlanLimitError, NotFoundError } from "@/lib/errors";

type RequestUploadInput = {
  folderId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type RequestUploadResult = { assetId: string; upload: UploadTarget } | { error: string };

/**
 * Provision a media asset and hand the browser a presigned target to PUT the
 * bytes to. Gated by `requireRole("media.create")` before any work.
 *
 * The MIME type decides the `kind`; anything `classifyKind` does not recognise
 * is refused. `sizeBytes` is the client's declared size: it is validated, held
 * to the per-kind ceiling, and signed onto the presigned PUT as the exact
 * accepted body length; `finalizeUpload` re-checks the real object. The plan's
 * storage ceiling is enforced with `assertCanAddStorage`
 * (its `PlanLimitError` is returned as `{ error }`, never thrown). The storage
 * key is always derived from the org id, the new asset id and the extension for
 * the MIME type, never from anything the caller sent.
 */
export async function requestUpload(
  input: RequestUploadInput,
): Promise<RequestUploadResult> {
  const ctx = await requireRole("media.create");

  if (!requestUploadSchema.safeParse(input).success) {
    return { error: "That upload request is not valid." };
  }

  const kind = classifyKind(input.mimeType);
  if (!kind) return { error: "That file type is not supported." };

  if (input.sizeBytes > MEDIA_MAX_BYTES[kind]) {
    return { error: "That file is larger than the upload size limit for this media type." };
  }

  if (input.folderId) {
    const folder = await ctx.db.mediaFolder.findUnique({ where: { id: input.folderId } });
    if (!folder) return { error: "Choose a folder from your organization." };
  }

  try {
    await assertCanAddStorage(ctx.organizationId, BigInt(input.sizeBytes));
  } catch (err) {
    if (err instanceof PlanLimitError) return { error: err.userMessage };
    throw err;
  }

  const asset = await ctx.db.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      folderId: input.folderId ?? null,
      kind,
      status: "UPLOADING",
      name: deriveName(input.filename),
      originalFilename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      createdByUserId: ctx.user.id,
    },
  });

  const key = assetStorageKey(ctx.organizationId, asset.id, extForMime(input.mimeType));
  await ctx.db.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });

  const upload = await storage.createUploadUrl(key, input.mimeType, input.sizeBytes);

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.upload.request",
    targetType: "MediaAsset",
    targetId: asset.id,
  });

  revalidatePath("/media");
  return { assetId: asset.id, upload };
}

type FinalizeResult = { status: "READY" | "FAILED"; duplicateOf?: string };

/**
 * Confirm an upload the browser has finished writing. Gated by
 * `requireRole("media.create")`.
 *
 * The row must still be `UPLOADING`. The stored object is verified against the
 * row before anything trusts it: it must exist, its size must equal the row's
 * declared size, and its reported content type (when the store gives one) must
 * equal the row's MIME type. Any of those failing marks the row `FAILED`, and
 * on a size or content-type mismatch the object is actively deleted first so a
 * row flipped to `FAILED` never leaves an object orphaned in the bucket. The
 * presigned PUT now signs the exact declared byte size, so a size mismatch here
 * is a defensive backstop rather than the primary size control. A missing
 * object needs no delete.
 *
 * On success the bytes are streamed once through a SHA-256 hash. For an image
 * the same bytes feed a `sharp` pipeline for the dimensions and a 480px webp
 * thumbnail; for a video a global `MediaProcessingJob` is enqueued (that queue
 * table has no organization, so it is reached through the root client). A prior
 * non-archived `READY` asset in the org with the same checksum is reported as
 * `duplicateOf`; the upload still completes.
 */
export async function finalizeUpload(assetId: string): Promise<FinalizeResult> {
  const ctx = await requireRole("media.create");

  const asset = await ctx.db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== "UPLOADING" || !asset.storageKey) {
    throw new NotFoundError("That upload is no longer available.");
  }
  const storageKey = asset.storageKey;

  const fail = async (deleteObject: boolean): Promise<FinalizeResult> => {
    if (deleteObject) {
      await storage.deletePrefix(assetPrefix(ctx.organizationId, asset.id));
    }
    await ctx.db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED" },
    });
    return { status: "FAILED" };
  };

  const head = await storage.headObject(storageKey);
  if (!head) return fail(false);
  if (head.sizeBytes !== Number(asset.sizeBytes)) return fail(true);
  if (head.contentType && head.contentType !== asset.mimeType) return fail(true);

  // Everything past the head checks trusts the object enough to decode it. A
  // body that lies about its type (text pinned as image/png by the presigned
  // PUT) makes `sharp` throw; a decompression bomb is bounded by
  // `limitInputPixels`. Any failure in here lands on the FAILED + deletePrefix
  // path rather than stranding the row `UPLOADING` and billed.
  try {
    const hash = createHash("sha256");
    const stream = await storage.getObjectStream(storageKey);
    const keepImageBytes = asset.kind === "IMAGE";
    const imageChunks: Buffer[] = [];
    await consumeStream(stream, hash, keepImageBytes ? (b) => imageChunks.push(b) : undefined);
    const checksum = hash.digest("hex");

    let width: number | undefined;
    let height: number | undefined;
    let thumbnailKey: string | undefined;

    if (asset.kind === "IMAGE") {
      const buf = Buffer.concat(imageChunks);
      const meta = await sharp(buf, { limitInputPixels: 100_000_000 }).metadata();
      width = meta.width;
      height = meta.height;
      const thumb = await sharp(buf, { limitInputPixels: 100_000_000 })
        .resize(480, 480, { fit: "inside" })
        .webp()
        .toBuffer();
      thumbnailKey = assetThumbKey(ctx.organizationId, asset.id);
      await storage.putObject(thumbnailKey, thumb, "image/webp");
    }

    if (asset.kind === "VIDEO") {
      await prisma.mediaProcessingJob.upsert({
        where: { mediaAssetId: asset.id },
        create: { mediaAssetId: asset.id },
        update: {},
      });
    }

    const dup = await ctx.db.mediaAsset.findFirst({
      where: { checksum, archivedAt: null, status: "READY", id: { not: asset.id } },
    });

    await ctx.db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "READY", checksum, width, height, thumbnailKey },
    });

    await writeAudit({
      organizationId: ctx.organizationId,
      actorType: "USER",
      actorId: ctx.user.id,
      action: "media.upload",
      targetType: "MediaAsset",
      targetId: asset.id,
    });

    revalidatePath("/media");
    return { status: "READY", duplicateOf: dup?.id };
  } catch {
    return fail(true);
  }
}

/**
 * Drain a readable once, feeding every chunk to `hash`. `onChunk` is invoked
 * with each chunk when the caller also needs the bytes in memory (the image
 * path); the video path passes no callback so nothing is retained.
 */
function consumeStream(
  stream: NodeJS.ReadableStream,
  hash: Hash,
  onChunk?: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buf);
      onChunk?.(buf);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Create a folder in the caller's org, optionally under `parentId`. Gated by
 * `requireRole("media.folder.manage")`. A `parentId` is verified through the
 * tenant facade, so one naming another org's folder is refused here. The
 * `@@unique([organizationId, parentId, name])` constraint means a duplicate
 * name under the same parent throws P2002, which is returned as `{ error }`.
 */
export async function createFolder(
  input: { name: string; parentId?: string },
): Promise<{ id?: string; error?: string }> {
  const ctx = await requireRole("media.folder.manage");

  if (!createFolderSchema.safeParse(input).success) {
    return { error: "Enter a folder name." };
  }

  if (input.parentId) {
    const parent = await ctx.db.mediaFolder.findUnique({ where: { id: input.parentId } });
    if (!parent) return { error: "Choose a folder from your organization." };
  }

  let folder;
  try {
    folder = await ctx.db.mediaFolder.create({
      data: {
        organizationId: ctx.organizationId,
        parentId: input.parentId ?? null,
        name: input.name,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "A folder with that name already exists here." };
    }
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.folder.create",
    targetType: "MediaFolder",
    targetId: folder.id,
  });

  revalidatePath("/media");
  return { id: folder.id };
}

/**
 * Rename a folder in the caller's org. Gated by
 * `requireRole("media.folder.manage")`. A name that collides with a sibling
 * throws P2002 and is returned as `{ error }`.
 */
export async function renameFolder(id: string, name: string): Promise<{ error?: string }> {
  const ctx = await requireRole("media.folder.manage");

  if (!idSchema.safeParse(id).success || !renameFolderSchema.safeParse({ name }).success) {
    return { error: "Enter a folder name." };
  }

  const folder = await ctx.db.mediaFolder.findUnique({ where: { id } });
  if (!folder) return { error: "That folder no longer exists." };

  try {
    await ctx.db.mediaFolder.update({ where: { id }, data: { name } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "A folder with that name already exists here." };
    }
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.folder.rename",
    targetType: "MediaFolder",
    targetId: id,
  });

  revalidatePath("/media");
  return {};
}

/**
 * Reparent a folder. Gated by `requireRole("media.folder.manage")`. `parentId`
 * (when not null) must be a folder in the same org, and may not be the folder
 * itself or any of its descendants: the ancestor chain is walked upward from
 * `parentId` and a hit on `id` rejects the move. A resulting name collision
 * with a sibling under the new parent throws P2002, returned as `{ error }`.
 */
export async function moveFolder(
  id: string,
  parentId: string | null,
): Promise<{ error?: string }> {
  const ctx = await requireRole("media.folder.manage");

  if (!idSchema.safeParse(id).success) return { error: "That folder no longer exists." };

  const folder = await ctx.db.mediaFolder.findUnique({ where: { id } });
  if (!folder) return { error: "That folder no longer exists." };

  if (parentId !== null) {
    if (parentId === id) return { error: "You cannot move a folder inside itself." };

    const parent = await ctx.db.mediaFolder.findUnique({ where: { id: parentId } });
    if (!parent) return { error: "Choose a folder from your organization." };

    let cursor: string | null = parentId;
    while (cursor !== null) {
      if (cursor === id) return { error: "You cannot move a folder inside itself." };
      const ancestor: { parentId: string | null } | null =
        await ctx.db.mediaFolder.findUnique({ where: { id: cursor } });
      cursor = ancestor?.parentId ?? null;
    }
  }

  try {
    await ctx.db.mediaFolder.update({ where: { id }, data: { parentId } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "A folder with that name already exists here." };
    }
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.folder.move",
    targetType: "MediaFolder",
    targetId: id,
    metadata: { parentId },
  });

  revalidatePath("/media");
  return {};
}

/**
 * Delete a folder in the caller's org. Gated by
 * `requireRole("media.folder.manage")`. The schema does the rest: child folders
 * cascade, and the assets that lived here have their `folderId` set to null
 * rather than being deleted.
 */
export async function deleteFolder(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("media.folder.manage");

  if (!idSchema.safeParse(id).success) return { error: "That folder no longer exists." };

  const folder = await ctx.db.mediaFolder.findUnique({ where: { id } });
  if (!folder) return { error: "That folder no longer exists." };

  await ctx.db.mediaFolder.delete({ where: { id } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.folder.delete",
    targetType: "MediaFolder",
    targetId: id,
  });

  revalidatePath("/media");
  return {};
}

/**
 * Register a web page as a media asset. Gated by `requireRole("media.create")`.
 * The URL is checked by `validateWebUrl` (http or https, no embedded
 * credentials); a failure is returned as `{ error }`. No object is stored: a
 * WEB asset is `READY` on creation.
 */
export async function createWebContent(
  input: { name: string; url: string },
): Promise<{ id?: string; error?: string }> {
  const ctx = await requireRole("media.create");

  if (!createWebContentSchema.safeParse(input).success) {
    return { error: "Enter a name and URL." };
  }

  const result = validateWebUrl(input.url);
  if (!result.ok) return { error: result.error };

  const asset = await ctx.db.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      kind: "WEB",
      status: "READY",
      name: input.name,
      url: result.url,
      createdByUserId: ctx.user.id,
    },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.web.create",
    targetType: "MediaAsset",
    targetId: asset.id,
  });

  revalidatePath("/media");
  return { id: asset.id };
}

/**
 * Patch an asset's name, tags or folder. Gated by `requireRole("media.update")`.
 * A `folderId` (when not null) must name a folder in the same org. Tags are
 * trimmed, empties dropped, deduped preserving first-seen order; more than 20
 * entries, or any entry longer than 40 characters, is rejected.
 */
export async function updateAsset(
  id: string,
  patch: { name?: string; tags?: string[]; folderId?: string | null },
): Promise<{ error?: string }> {
  const ctx = await requireRole("media.update");

  if (!idSchema.safeParse(id).success || !updateAssetSchema.safeParse(patch).success) {
    return { error: "That change is not valid." };
  }

  const asset = await ctx.db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return { error: "That item no longer exists." };

  const data: { name?: string; tags?: string[]; folderId?: string | null } = {};

  if (patch.name !== undefined) data.name = patch.name;

  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      const folder = await ctx.db.mediaFolder.findUnique({ where: { id: patch.folderId } });
      if (!folder) return { error: "Choose a folder from your organization." };
    }
    data.folderId = patch.folderId;
  }

  if (patch.tags !== undefined) {
    const tags: string[] = [];
    for (const raw of patch.tags) {
      const tag = raw.trim();
      if (!tag || tags.includes(tag)) continue;
      tags.push(tag);
    }
    if (tags.length > 20 || tags.some((tag) => tag.length > 40)) {
      return { error: "Tags must be 20 or fewer, each 40 characters or less." };
    }
    data.tags = tags;
  }

  await ctx.db.mediaAsset.update({ where: { id }, data });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.update",
    targetType: "MediaAsset",
    targetId: id,
  });

  revalidatePath("/media");
  return {};
}

/**
 * Soft-delete assets: stamp `archivedAt` on every id in the caller's org that
 * is not already archived. Gated by `requireRole("media.delete")`. Purging the
 * stored objects is the worker's job. Returns the number of rows archived.
 */
export async function deleteAssets(
  ids: string[],
): Promise<{ archived: number; error?: string }> {
  const ctx = await requireRole("media.delete");

  if (!Array.isArray(ids) || ids.some((id) => !idSchema.safeParse(id).success)) {
    return { archived: 0, error: "That request is not valid." };
  }

  if (ids.length === 0) return { archived: 0 };

  const { count } = await ctx.db.mediaAsset.updateMany({
    where: { id: { in: ids }, archivedAt: null },
    data: { archivedAt: new Date() },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.delete",
    targetType: "MediaAsset",
    metadata: { count },
  });

  revalidatePath("/media");
  return { archived: count };
}

/**
 * Bring an archived asset back. Gated by `requireRole("media.update")`. The row
 * must be archived; for a non-WEB asset the stored object must still be there
 * (`storage.headObject`), otherwise the restore is refused.
 */
export async function restoreAsset(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("media.update");

  if (!idSchema.safeParse(id).success) return { error: "That item no longer exists." };

  const asset = await ctx.db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return { error: "That item no longer exists." };
  if (!asset.archivedAt) return { error: "That item is not archived." };

  if (asset.kind !== "WEB") {
    const head = asset.storageKey ? await storage.headObject(asset.storageKey) : null;
    if (!head) {
      return { error: "The stored file for this item is gone and it cannot be restored." };
    }
  }

  await ctx.db.mediaAsset.update({ where: { id }, data: { archivedAt: null } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "media.restore",
    targetType: "MediaAsset",
    targetId: id,
  });

  revalidatePath("/media");
  return {};
}
