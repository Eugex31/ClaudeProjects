import { formatDistanceToNow } from "date-fns";
import { ListVideo } from "lucide-react";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { withOrgTransaction } from "@/lib/db/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { NewPlaylistDialog } from "@/components/app/playlists/new-playlist-dialog";
import { PlaylistList, type PlaylistListRow } from "@/components/app/playlists/playlist-list";

export const metadata = { title: "Playlists" };

/**
 * Playlists index for the active organization. One `withOrgTransaction` loads
 * every live playlist with its item count, then a grouped screen count so each
 * row can show how many screens are playing it. Everything handed to the client
 * is serializable: the update time is turned into a relative-time label here.
 */
export default async function PlaylistsPage() {
  const ctx = await requireRole("playlist.view");
  const canCreate = can(ctx.actor, "playlist.create");

  const rows: PlaylistListRow[] = await withOrgTransaction(
    ctx.organizationId,
    async (tx) => {
      const playlists = await tx.playlist.findMany({
        where: { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { items: true } } },
      });
      const screenCounts = await tx.screen.groupBy({
        by: ["playlistId"],
        where: { playlistId: { not: null } },
        _count: { _all: true },
      });
      const countByPlaylist = new Map(
        screenCounts.map((s) => [s.playlistId as string, s._count._all]),
      );
      return playlists.map((p) => ({
        id: p.id,
        name: p.name,
        itemCount: p._count.items,
        screenCount: countByPlaylist.get(p.id) ?? 0,
        updatedLabel: formatDistanceToNow(p.updatedAt, { addSuffix: true }),
      }));
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playlists"
        description="Ordered sequences of media that play on your screens."
        actions={canCreate ? <NewPlaylistDialog /> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={ListVideo}
          title="No playlists yet"
          description="Create a playlist to sequence media for your screens."
          action={canCreate ? <NewPlaylistDialog /> : null}
        />
      ) : (
        <PlaylistList rows={rows} />
      )}
    </div>
  );
}
