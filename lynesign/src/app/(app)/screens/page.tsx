import { Monitor } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { requireOrg } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ScreenForm } from "@/components/app/screen-form";
import { ScreensTable, type ScreenTableRow } from "@/app/(app)/screens/screens-table";

export const metadata = { title: "Screens" };

type ScreenRow = ScreenTableRow;

function lastSeenLabel(lastSeenAt: Date | null): string {
  if (!lastSeenAt) return "Never";
  return formatDistanceToNow(lastSeenAt, { addSuffix: true });
}

/**
 * Screens list for the active organization. Reads through the tenant facade, so
 * every row is scoped to the caller's org. Content managers and up get an "Add
 * screen" dialog; the plan's screen ceiling is enforced server-side by the
 * create action.
 */
export default async function ScreensPage() {
  const ctx = await requireOrg();

  const [screens, locations, playlists, canvases] = await Promise.all([
    ctx.db.screen.findMany({
      orderBy: { name: "asc" },
      include: {
        location: { select: { name: true } },
        playlist: { select: { name: true } },
        canvas: { select: { name: true } },
      },
    }),
    ctx.db.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.playlist.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    ctx.db.canvas.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canAssignPlaylist = can(ctx.actor, "playlist.assign");
  const canUpdateScreen = can(ctx.actor, "screen.update");

  const rows: ScreenRow[] = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    locationName: screen.location?.name ?? "Unassigned",
    status: screen.status,
    lastSeen: lastSeenLabel(screen.lastSeenAt),
    playlistId: screen.playlistId,
    canvasId: screen.canvasId,
    playlistName: screen.playlist?.name ?? null,
    canvasName: screen.canvas?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screens"
        description="Every display on your network. Add a screen to get a pairing code, then enter it on the device to bring it online."
        actions={
          <ScreenForm
            locations={locations}
            playlists={playlists}
            canAssignPlaylist={canAssignPlaylist}
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No screens yet"
          description="Add your first screen to start showing content."
          action={
            <ScreenForm
              locations={locations}
              playlists={playlists}
              canAssignPlaylist={canAssignPlaylist}
            />
          }
        />
      ) : (
        <ScreensTable
          rows={rows}
          playlists={playlists}
          canvases={canvases}
          canUpdate={canUpdateScreen}
        />
      )}
    </div>
  );
}
