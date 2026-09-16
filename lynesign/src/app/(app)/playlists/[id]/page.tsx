import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { withOrgTransaction } from "@/lib/db/tenant";
import { storage } from "@/lib/storage";
import { PageHeader } from "@/components/app/page-header";
import {
  PlaylistEditor,
  type EditorPlaylist,
} from "@/components/app/playlists/playlist-editor";
import type { PlaylistRowItem } from "@/components/app/playlists/playlist-item-row";
import type { PanelScreen } from "@/components/app/playlists/assigned-screens-panel";
import type { AddMediaAsset } from "@/components/app/playlists/add-media-dialog";

export const metadata = { title: "Playlist" };

type Kind = "IMAGE" | "VIDEO" | "WEB";

/**
 * Playlist editor for one playlist in the active organization. A single
 * `withOrgTransaction` loads the playlist, its ordered items with their media
 * assets, every screen, and the ready library assets for the add-media picker.
 * Thumbnails are pre-signed here so the editor never fans out one request per
 * row, and each item's play time is resolved server-side so the client can sum
 * without re-deriving it. Everything handed across the boundary is serializable:
 * dates become booleans, and no closures are passed.
 */
export default async function PlaylistEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireRole("playlist.view");

  const data = await withOrgTransaction(ctx.organizationId, async (tx) => {
    const playlist = await tx.playlist.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        revision: true,
        defaultImageDurationSeconds: true,
        defaultWebDurationSeconds: true,
        archivedAt: true,
      },
    });
    if (!playlist) return null;

    const items = await tx.playlistItem.findMany({
      where: { playlistId: id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        durationSeconds: true,
        enabled: true,
        mediaAsset: {
          select: {
            id: true,
            name: true,
            kind: true,
            status: true,
            archivedAt: true,
            thumbnailKey: true,
            durationSeconds: true,
          },
        },
      },
    });

    const screens = await tx.screen.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        playlistId: true,
        location: { select: { name: true } },
      },
    });

    const libraryAssets = await tx.mediaAsset.findMany({
      where: { archivedAt: null, status: "READY" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, thumbnailKey: true },
    });

    return { playlist, items, screens, libraryAssets };
  });

  if (!data) notFound();
  const { playlist, items, screens, libraryAssets } = data;

  const keys = new Set<string>();
  for (const item of items) {
    if (item.mediaAsset.thumbnailKey) keys.add(item.mediaAsset.thumbnailKey);
  }
  for (const asset of libraryAssets) {
    if (asset.thumbnailKey) keys.add(asset.thumbnailKey);
  }
  const urlByKey = new Map<string, string>();
  await Promise.all(
    [...keys].map(async (key) => {
      urlByKey.set(key, await storage.createDownloadUrl(key, 3600));
    }),
  );

  const resolve = (
    kind: Kind,
    assetDuration: number | null,
    override: number | null,
  ): number => {
    if (override !== null) return override;
    if (kind === "VIDEO") return assetDuration ?? 0;
    if (kind === "WEB") return playlist.defaultWebDurationSeconds;
    return playlist.defaultImageDurationSeconds;
  };

  const serializablePlaylist: EditorPlaylist = {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    defaultImageDurationSeconds: playlist.defaultImageDurationSeconds,
    defaultWebDurationSeconds: playlist.defaultWebDurationSeconds,
    isArchived: playlist.archivedAt !== null,
  };

  const serializableItems: PlaylistRowItem[] = items.map((item) => ({
    id: item.id,
    position: item.position,
    durationSeconds: item.durationSeconds,
    enabled: item.enabled,
    resolvedDurationSeconds: resolve(
      item.mediaAsset.kind as Kind,
      item.mediaAsset.durationSeconds,
      item.durationSeconds,
    ),
    mediaAsset: {
      id: item.mediaAsset.id,
      name: item.mediaAsset.name,
      kind: item.mediaAsset.kind as Kind,
      status: item.mediaAsset.status,
      isArchived: item.mediaAsset.archivedAt !== null,
      thumbnailUrl: item.mediaAsset.thumbnailKey
        ? urlByKey.get(item.mediaAsset.thumbnailKey) ?? null
        : null,
    },
  }));

  const serializableScreens: PanelScreen[] = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    locationName: screen.location.name,
    playlistId: screen.playlistId,
  }));

  const serializableLibraryAssets: AddMediaAsset[] = libraryAssets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: asset.kind as Kind,
    thumbnailUrl: asset.thumbnailKey
      ? urlByKey.get(asset.thumbnailKey) ?? null
      : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={playlist.name}
        description="Add media, set the order, and choose which screens play it."
      />
      <PlaylistEditor
        playlist={serializablePlaylist}
        items={serializableItems}
        screens={serializableScreens}
        libraryAssets={serializableLibraryAssets}
        assignedScreenIds={screens
          .filter((screen) => screen.playlistId === id)
          .map((screen) => screen.id)}
        canUpdate={can(ctx.actor, "playlist.update")}
        canDelete={can(ctx.actor, "playlist.delete")}
        canAssign={can(ctx.actor, "playlist.assign")}
      />
    </div>
  );
}
