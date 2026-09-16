import { z } from "zod";

/**
 * Input schemas for the media library server actions. Each action safe-parses
 * its argument straight after `requireRole(...)` as a front gate: it rejects a
 * negative, fractional or `NaN` size, an empty name, an over-long string or a
 * blank id before any of that reaches `BigInt(...)`, the storage layer or the
 * database. The existing downstream checks (`classifyKind`, `validateWebUrl`,
 * tag normalization, the per-kind size cap) still run after it.
 */
export const requestUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  folderId: z.string().min(1).optional(),
});

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).optional(),
});

export const renameFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createWebContentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2048),
});

export const updateAssetSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.string().min(1).nullable().optional(),
});

/** Guard for the bare id arguments of delete / restore / move / delete-folder. */
export const idSchema = z.string().min(1);
