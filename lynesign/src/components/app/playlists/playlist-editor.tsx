"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ListVideo, MonitorPlay, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deletePlaylist, reorderItems } from "@/app/(app)/playlists/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/app/empty-state";
import {
  PlaylistItemRow,
  type PlaylistRowItem,
} from "@/components/app/playlists/playlist-item-row";
import {
  AddMediaDialog,
  type AddMediaAsset,
} from "@/components/app/playlists/add-media-dialog";
import {
  AssignedScreensPanel,
  type PanelScreen,
} from "@/components/app/playlists/assigned-screens-panel";
import { PlaylistSettingsDialog } from "@/components/app/playlists/playlist-settings-dialog";
import { PlaylistPreviewDialog } from "@/components/app/playlists/playlist-preview-dialog";

export interface EditorPlaylist {
  id: string;
  name: string;
  description: string | null;
  defaultImageDurationSeconds: number;
  defaultWebDurationSeconds: number;
  isArchived: boolean;
}

export interface PlaylistEditorProps {
  playlist: EditorPlaylist;
  items: PlaylistRowItem[];
  screens: PanelScreen[];
  libraryAssets: AddMediaAsset[];
  assignedScreenIds: string[];
  canUpdate: boolean;
  canDelete: boolean;
  canAssign: boolean;
}

/** "1h 5m", "2m 30s", "45s". Zero renders as "0s". */
export function secondsToLabel(total: number): string {
  const whole = Math.max(0, Math.round(total));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

/**
 * Client shell for the playlist editor. Owns the ordered item list, the running
 * play-time total, and every mutation: reorder is computed here because it needs
 * the whole sibling order, while the rows call the single-item actions
 * themselves. Add-media, settings and delete are controlled dialogs so the
 * server page never has to pass a function across the boundary.
 */
export function PlaylistEditor({
  playlist,
  items,
  screens,
  libraryAssets,
  assignedScreenIds,
  canUpdate,
  canDelete,
  canAssign,
}: PlaylistEditorProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const totalSeconds = items.reduce((sum, item) => {
    const available =
      item.mediaAsset.status === "READY" && !item.mediaAsset.isArchived;
    return item.enabled && available
      ? sum + item.resolvedDurationSeconds
      : sum;
  }, 0);

  function onMove(itemId: string, direction: "up" | "down") {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    const order = items.map((item) => item.id);
    [order[index], order[target]] = [order[target], order[index]];
    startTransition(async () => {
      const result = await reorderItems(playlist.id, { itemIds: order });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deletePlaylist(playlist.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Playlist deleted.");
      router.push("/playlists");
    });
  }

  return (
    <div className="space-y-6">
      {playlist.isArchived ? (
        <p className="rounded-panel border border-hairline bg-muted/40 px-4 py-2 text-sm text-body">
          This playlist is archived.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-ink">
          Total {secondsToLabel(totalSeconds)}
        </span>
        <span className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
          >
            <MonitorPlay aria-hidden />
            Preview
          </Button>
          {canUpdate ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden />
                Add media
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings aria-hidden />
                Settings
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {items.length === 0 ? (
            <EmptyState
              icon={ListVideo}
              title="No media in this playlist"
              description={
                canUpdate
                  ? "Use Add media to put images, videos and web pages in order."
                  : "Media added by your team will show up here."
              }
            />
          ) : (
            <ul className="divide-y divide-hairline rounded-panel border border-hairline bg-surface">
              {items.map((item, index) => (
                <PlaylistItemRow
                  key={item.id}
                  item={item}
                  canUpdate={canUpdate}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onMove={onMove}
                />
              ))}
            </ul>
          )}
        </div>

        <AssignedScreensPanel
          playlistId={playlist.id}
          screens={screens}
          assignedScreenIds={assignedScreenIds}
          canAssign={canAssign}
        />
      </div>

      {canDelete ? (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              Delete playlist
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canUpdate ? (
        <>
          <AddMediaDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            playlistId={playlist.id}
            assets={libraryAssets}
          />
          <PlaylistSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            playlist={playlist}
          />
        </>
      ) : null}

      <PlaylistPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        playlistId={playlist.id}
        playlistName={playlist.name}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {playlist.name}</DialogTitle>
            <DialogDescription>
              This removes the playlist and its item order. Screens playing it
              fall back to no playlist. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete playlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
