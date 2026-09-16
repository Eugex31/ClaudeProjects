import { describe, it, expect } from "vitest";
import {
  createPlaylistSchema,
  updatePlaylistSchema,
  addItemsSchema,
  setItemDurationSchema,
  reorderItemsSchema,
} from "@/lib/validation/playlists";

describe("playlist validation", () => {
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
});
