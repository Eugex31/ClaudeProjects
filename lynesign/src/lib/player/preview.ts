import { assembleManifest, type ManifestItem } from "@/lib/player/manifest";
import { storage } from "@/lib/storage";
import { NotFoundError } from "@/lib/errors";
import type { forOrg } from "@/lib/db/tenant";

const DOWNLOAD_URL_TTL_SECONDS = 3600;

/**
 * Assemble the preview manifest for one playlist through a tenant-scoped client.
 * Shared by the playlist and campaign preview routes: it loads the playlist, its
 * enabled items in position order and their media assets, presigns each storage
 * key once, then hands everything to the pure `assembleManifest`.
 *
 * Every read goes through `db`, so a playlist id outside the caller's active
 * organization is invisible and this throws `NotFoundError`.
 */
export async function assemblePlaylistPreview(
  db: ReturnType<typeof forOrg>,
  playlistId: string,
): Promise<{ id: string; name: string; revision: number; items: ManifestItem[] }> {
  const playlist = await db.playlist.findUnique({
    where: { id: playlistId },
    select: {
      id: true,
      name: true,
      revision: true,
      defaultImageDurationSeconds: true,
      defaultWebDurationSeconds: true,
    },
  });
  if (!playlist) {
    throw new NotFoundError("That playlist is not available.");
  }

  const items = await db.playlistItem.findMany({
    where: { playlistId: playlist.id, enabled: true },
    orderBy: { position: "asc" },
    select: {
      id: true,
      mediaAssetId: true,
      position: true,
      durationSeconds: true,
      enabled: true,
    },
  });

  const assets = items.length
    ? await db.mediaAsset.findMany({
        where: { id: { in: items.map((i) => i.mediaAssetId) } },
        select: {
          id: true,
          kind: true,
          status: true,
          archivedAt: true,
          storageKey: true,
          url: true,
          mimeType: true,
          width: true,
          height: true,
          durationSeconds: true,
        },
      })
    : [];

  const assetsById = new Map(assets.map((a) => [a.id, a]));

  const keys = [
    ...new Set(
      assets
        .filter((a) => a.storageKey != null && a.storageKey !== "")
        .map((a) => a.storageKey as string),
    ),
  ];
  const signed = await Promise.all(
    keys.map((k) => storage.createDownloadUrl(k, DOWNLOAD_URL_TTL_SECONDS)),
  );
  const urlMap = new Map(keys.map((k, i) => [k, signed[i]]));

  const manifestItems = assembleManifest({
    playlist: {
      defaultImageDurationSeconds: playlist.defaultImageDurationSeconds,
      defaultWebDurationSeconds: playlist.defaultWebDurationSeconds,
    },
    items,
    assetsById,
    signUrl: (k) => urlMap.get(k) ?? "",
  });

  return {
    id: playlist.id,
    name: playlist.name,
    revision: playlist.revision,
    items: manifestItems,
  };
}
