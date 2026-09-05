// Pure assembly of a player manifest from a playlist, its items, and the media
// assets they reference. No I/O, no network, no database. The function never
// throws: any item it cannot render is silently skipped.

export interface ManifestItem {
  id: string;
  kind: "IMAGE" | "VIDEO" | "WEB";
  url: string;
  durationSeconds: number; // 0 for a video of unknown length => play to natural end
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

interface PlaylistLike {
  defaultImageDurationSeconds: number;
  defaultWebDurationSeconds: number;
}

interface PlaylistItemLike {
  id: string;
  mediaAssetId: string;
  position: number;
  durationSeconds: number | null;
  enabled: boolean;
}

interface AssetLike {
  kind: "IMAGE" | "VIDEO" | "WEB";
  status: string;
  archivedAt: Date | null;
  storageKey: string | null;
  url: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export function assembleManifest(args: {
  playlist: PlaylistLike;
  items: PlaylistItemLike[];
  assetsById: Map<string, AssetLike>;
  signUrl: (storageKey: string) => string;
}): ManifestItem[] {
  const { playlist, items, assetsById, signUrl } = args;

  const ordered = [...items].sort((a, b) => a.position - b.position);
  const manifest: ManifestItem[] = [];

  for (const item of ordered) {
    if (!item.enabled) continue;

    const asset = assetsById.get(item.mediaAssetId);
    if (!asset) continue;
    if (asset.status !== "READY") continue;
    if (asset.archivedAt != null) continue;

    const url = resolveUrl(asset, signUrl);
    if (url == null) continue;

    manifest.push({
      id: item.id,
      kind: asset.kind,
      url,
      durationSeconds: resolveDuration(item, asset, playlist),
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    });
  }

  return manifest;
}

function resolveUrl(
  asset: AssetLike,
  signUrl: (storageKey: string) => string,
): string | null {
  if (asset.kind === "WEB") {
    return asset.url;
  }
  if (asset.storageKey == null) {
    return null;
  }
  return signUrl(asset.storageKey);
}

function resolveDuration(
  item: PlaylistItemLike,
  asset: AssetLike,
  playlist: PlaylistLike,
): number {
  if (item.durationSeconds != null) {
    return item.durationSeconds;
  }
  if (asset.kind === "IMAGE") {
    return playlist.defaultImageDurationSeconds;
  }
  if (asset.kind === "WEB") {
    return playlist.defaultWebDurationSeconds;
  }
  return asset.durationSeconds ?? 0;
}
