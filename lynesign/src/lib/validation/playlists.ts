import { z } from "zod";

/**
 * Input schemas for the playlist server actions. Each action safe-parses its
 * argument straight after the role check as a front gate: it rejects a blank or
 * over-long name, an out-of-range duration, an empty or oversized batch and a
 * blank id before any of that reaches the database. Reorder rewrites every
 * item's position wholesale, so it only needs a non-empty id list.
 */
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
