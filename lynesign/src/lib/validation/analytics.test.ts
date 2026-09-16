import { describe, it, expect } from "vitest";
import { playbackBatchSchema, withinIngestWindow } from "./analytics";

const ok = {
  id: "evt-1", screenId: "ckxym0000000000000000000a", source: "playlist",
  airedAt: "2026-09-01T10:00:00.000Z", durationSeconds: 15,
};

describe("playbackBatchSchema", () => {
  it("accepts a minimal valid batch", () => {
    expect(playbackBatchSchema.safeParse({ events: [ok] }).success).toBe(true);
  });
  it("rejects an empty batch", () => {
    expect(playbackBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });
  it("rejects more than 500 events", () => {
    expect(playbackBatchSchema.safeParse({ events: Array(501).fill(ok) }).success).toBe(false);
  });
  it("rejects a negative duration", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, durationSeconds: -1 }] }).success).toBe(false);
  });
  it("rejects a bad source", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, source: "none" }] }).success).toBe(false);
  });
  it("rejects a non-ISO airedAt", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, airedAt: "2026-09-01" }] }).success).toBe(false);
  });
  it("allows null content ids", () => {
    expect(playbackBatchSchema.safeParse({ events: [{ ...ok, mediaAssetId: null, campaignId: null }] }).success).toBe(true);
  });
});

describe("withinIngestWindow", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  it("accepts an event from an hour ago", () => {
    expect(withinIngestWindow(new Date("2026-09-08T11:00:00.000Z"), now)).toBe(true);
  });
  it("accepts the 7-day-old boundary", () => {
    expect(withinIngestWindow(new Date("2026-09-01T12:00:00.000Z"), now)).toBe(true);
  });
  it("rejects 7 days and one second old", () => {
    expect(withinIngestWindow(new Date("2026-09-01T11:59:59.000Z"), now)).toBe(false);
  });
  it("accepts up to one hour in the future", () => {
    expect(withinIngestWindow(new Date("2026-09-08T13:00:00.000Z"), now)).toBe(true);
  });
  it("rejects more than one hour in the future", () => {
    expect(withinIngestWindow(new Date("2026-09-08T13:00:01.000Z"), now)).toBe(false);
  });
});
