"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CanvasPreviewDialog } from "@/components/app/canvas/canvas-preview-dialog";
import { PlaylistPreviewDialog } from "@/components/app/playlists/playlist-preview-dialog";

export interface ScreenPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screenId: string;
  screenName: string;
}

/** The thin body of `GET /api/screens/[id]/preview`. The id fields are present
 * only on the source that needs them. */
type Resolution =
  | { source: "canvas"; canvasId: string; screenName: string }
  | {
      source: "campaign" | "schedule" | "playlist";
      playlistId: string;
      label?: string | null;
      screenName: string;
    }
  | { source: "none"; screenName: string };

/** The muted line shown under the sub-dialog title, naming what the screen is
 * playing right now. `none` has no note because it renders its own empty state. */
function headerNoteFor(data: Resolution): string | undefined {
  switch (data.source) {
    case "canvas":
      return "Playing: canvas";
    case "campaign":
      return `Playing: campaign "${data.label ?? ""}"`;
    case "schedule":
      return `Playing: schedule rule "${data.label ?? ""}"`;
    case "playlist":
      return "Playing: this screen's playlist";
    default:
      return undefined;
  }
}

/**
 * Resolves what one screen is currently playing, then hands off to the matching
 * player with a "Demo" watermark and a header note. On open it fetches
 * `/api/screens/[id]/preview` (the thin resolution, session-authed); the canvas
 * and playlist sub-dialogs each fetch their own manifest from there. A canvas
 * source opens {@link CanvasPreviewDialog}; a campaign, schedule or base
 * playlist opens {@link PlaylistPreviewDialog} pointed at the effective
 * playlist; a screen with nothing to play, a load still in flight, and a
 * non-OK response each render a minimal dialog of their own rather than nothing.
 * The resolution is refetched every time the dialog opens.
 */
export function ScreenPreviewDialog({
  open,
  onOpenChange,
  screenId,
  screenName,
}: ScreenPreviewDialogProps) {
  const [data, setData] = React.useState<Resolution | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch(`/api/screens/${screenId}/preview`);
        if (!res.ok) throw new Error("unavailable");
        const body = (await res.json()) as Resolution;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) {
          setError("This screen's preview could not be loaded.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, screenId]);

  if (loading || error || !data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview: {screenName}</DialogTitle>
            <DialogDescription>
              Shows what this screen is playing right now.
            </DialogDescription>
          </DialogHeader>
          <p className="py-10 text-center text-sm text-muted-foreground">
            {error ?? "Loading"}
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  if (data.source === "none") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview: {screenName}</DialogTitle>
            <DialogDescription>
              Shows what this screen is playing right now.
            </DialogDescription>
          </DialogHeader>
          <p className="py-10 text-center text-sm text-muted-foreground">
            This screen has nothing to play right now.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const headerNote = headerNoteFor(data);

  if (data.source === "canvas") {
    return (
      <CanvasPreviewDialog
        open={open}
        onOpenChange={onOpenChange}
        canvasId={data.canvasId}
        demoWatermark
        headerNote={headerNote}
      />
    );
  }

  return (
    <PlaylistPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      playlistId={data.playlistId}
      playlistName={screenName}
      demoWatermark
      headerNote={headerNote}
    />
  );
}
