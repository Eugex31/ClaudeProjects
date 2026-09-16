import { describe, it, expect, vi } from "vitest";
import { assembleManifest, type ManifestItem } from "@/lib/player/manifest";

type Args = Parameters<typeof assembleManifest>[0];
type AssetLike = NonNullable<ReturnType<Args["assetsById"]["get"]>>;
type ItemLike = Args["items"][number];

function makeAsset(over: Partial<AssetLike> = {}): AssetLike {
  return {
    kind: "IMAGE",
    status: "READY",
    archivedAt: null,
    storageKey: "s3/key",
    url: null,
    mimeType: "image/png",
    width: 1920,
    height: 1080,
    durationSeconds: null,
    ...over,
  };
}

function makeItem(over: Partial<ItemLike> = {}): ItemLike {
  return {
    id: "item-1",
    mediaAssetId: "asset-1",
    position: 0,
    durationSeconds: null,
    enabled: true,
    ...over,
  };
}

const playlist = { defaultImageDurationSeconds: 10, defaultWebDurationSeconds: 20 };

function run(over: Partial<Args> = {}): ManifestItem[] {
  return assembleManifest({
    playlist,
    items: [],
    assetsById: new Map(),
    signUrl: (key: string) => `signed:${key}`,
    ...over,
  });
}

describe("assembleManifest", () => {
  it("returns enabled items ordered by position when input is out of order", () => {
    const items = [
      makeItem({ id: "b", mediaAssetId: "a-b", position: 5 }),
      makeItem({ id: "a", mediaAssetId: "a-a", position: 1 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-a", makeAsset({ storageKey: "key-a" })],
      ["a-b", makeAsset({ storageKey: "key-b" })],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out.map((m) => m.url)).toEqual(["signed:key-a", "signed:key-b"]);
  });

  it("drops a disabled item", () => {
    const items = [
      makeItem({ id: "on", mediaAssetId: "a-on", position: 1 }),
      makeItem({ id: "off", mediaAssetId: "a-off", position: 2, enabled: false }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-on", makeAsset()],
      ["a-off", makeAsset()],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.id)).toEqual(["on"]);
  });

  it("drops items whose asset is archived, failed, or missing from the map", () => {
    const items = [
      makeItem({ id: "ok", mediaAssetId: "a-ok", position: 1 }),
      makeItem({ id: "archived", mediaAssetId: "a-archived", position: 2 }),
      makeItem({ id: "failed", mediaAssetId: "a-failed", position: 3 }),
      makeItem({ id: "missing", mediaAssetId: "a-missing", position: 4 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-ok", makeAsset()],
      ["a-archived", makeAsset({ archivedAt: new Date("2026-01-01T00:00:00Z") })],
      ["a-failed", makeAsset({ status: "FAILED" })],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.id)).toEqual(["ok"]);
  });

  it("drops a WEB item with a null url and an IMAGE item with a null storageKey", () => {
    const items = [
      makeItem({ id: "web-null", mediaAssetId: "a-web", position: 1 }),
      makeItem({ id: "img-null", mediaAssetId: "a-img", position: 2 }),
      makeItem({ id: "web-ok", mediaAssetId: "a-web-ok", position: 3 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-web", makeAsset({ kind: "WEB", url: null, storageKey: null, mimeType: null, width: null, height: null })],
      ["a-img", makeAsset({ kind: "IMAGE", storageKey: null })],
      [
        "a-web-ok",
        makeAsset({ kind: "WEB", url: "https://example.com", storageKey: null, mimeType: null, width: null, height: null }),
      ],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.id)).toEqual(["web-ok"]);
    expect(out[0].url).toBe("https://example.com");
  });

  it("calls signUrl once per surviving IMAGE or VIDEO and never for WEB", () => {
    const signUrl = vi.fn((key: string) => `signed:${key}`);
    const items = [
      makeItem({ id: "img", mediaAssetId: "a-img", position: 1 }),
      makeItem({ id: "vid", mediaAssetId: "a-vid", position: 2 }),
      makeItem({ id: "web", mediaAssetId: "a-web", position: 3 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-img", makeAsset({ kind: "IMAGE", storageKey: "key-img" })],
      ["a-vid", makeAsset({ kind: "VIDEO", storageKey: "key-vid", durationSeconds: 42 })],
      [
        "a-web",
        makeAsset({ kind: "WEB", url: "https://example.com", storageKey: "should-not-sign", mimeType: null, width: null, height: null }),
      ],
    ]);

    const out = run({ items, assetsById, signUrl });

    expect(signUrl).toHaveBeenCalledTimes(2);
    expect(signUrl).toHaveBeenCalledWith("key-img");
    expect(signUrl).toHaveBeenCalledWith("key-vid");
    expect(signUrl).not.toHaveBeenCalledWith("should-not-sign");
    expect(out.map((m) => m.url)).toEqual(["signed:key-img", "signed:key-vid", "https://example.com"]);
  });

  it("uses the item duration override for every kind", () => {
    const items = [
      makeItem({ id: "img", mediaAssetId: "a-img", position: 1, durationSeconds: 3 }),
      makeItem({ id: "web", mediaAssetId: "a-web", position: 2, durationSeconds: 4 }),
      makeItem({ id: "vid", mediaAssetId: "a-vid", position: 3, durationSeconds: 5 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-img", makeAsset({ kind: "IMAGE", storageKey: "key-img" })],
      [
        "a-web",
        makeAsset({ kind: "WEB", url: "https://example.com", storageKey: null, mimeType: null, width: null, height: null }),
      ],
      ["a-vid", makeAsset({ kind: "VIDEO", storageKey: "key-vid", durationSeconds: 99 })],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.durationSeconds)).toEqual([3, 4, 5]);
  });

  it("falls back to playlist defaults for IMAGE and WEB without an override", () => {
    const items = [
      makeItem({ id: "img", mediaAssetId: "a-img", position: 1 }),
      makeItem({ id: "web", mediaAssetId: "a-web", position: 2 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-img", makeAsset({ kind: "IMAGE", storageKey: "key-img" })],
      [
        "a-web",
        makeAsset({ kind: "WEB", url: "https://example.com", storageKey: null, mimeType: null, width: null, height: null }),
      ],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.durationSeconds)).toEqual([10, 20]);
  });

  it("uses asset.durationSeconds for VIDEO without an override, and 0 when that is null", () => {
    const items = [
      makeItem({ id: "known", mediaAssetId: "a-known", position: 1 }),
      makeItem({ id: "unknown", mediaAssetId: "a-unknown", position: 2 }),
    ];
    const assetsById = new Map<string, AssetLike>([
      ["a-known", makeAsset({ kind: "VIDEO", storageKey: "key-known", durationSeconds: 128 })],
      ["a-unknown", makeAsset({ kind: "VIDEO", storageKey: "key-unknown", durationSeconds: null })],
    ]);

    const out = run({ items, assetsById });

    expect(out.map((m) => m.durationSeconds)).toEqual([128, 0]);
  });

  it("copies mimeType, width, and height from the asset", () => {
    const items = [makeItem({ id: "img", mediaAssetId: "a-img", position: 1 })];
    const assetsById = new Map<string, AssetLike>([
      [
        "a-img",
        makeAsset({ kind: "IMAGE", storageKey: "key-img", mimeType: "image/jpeg", width: 640, height: 480 }),
      ],
    ]);

    const out = run({ items, assetsById });

    expect(out[0]).toMatchObject({ mimeType: "image/jpeg", width: 640, height: 480, kind: "IMAGE" });
  });

  it("yields null mimeType, width, and height for a WEB item", () => {
    const items = [makeItem({ id: "web", mediaAssetId: "a-web", position: 1 })];
    const assetsById = new Map<string, AssetLike>([
      [
        "a-web",
        makeAsset({ kind: "WEB", url: "https://example.com", storageKey: null, mimeType: null, width: null, height: null }),
      ],
    ]);

    const out = run({ items, assetsById });

    expect(out[0]).toMatchObject({ mimeType: null, width: null, height: null, kind: "WEB" });
  });

  it("takes kind from the asset and never throws on an empty item list", () => {
    expect(run()).toEqual([]);
  });
});
