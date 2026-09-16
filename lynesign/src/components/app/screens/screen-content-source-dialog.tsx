"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setScreenContentSource } from "@/app/(app)/screens/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Source = "playlist" | "canvas" | "none";

export interface ScreenContentSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screen: {
    id: string;
    name: string;
    playlistId: string | null;
    canvasId: string | null;
  };
  playlists: Array<{ id: string; name: string }>;
  canvases: Array<{ id: string; name: string }>;
}

const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Points one screen at a playlist, a canvas, or nothing. A radio picks the
 * source and the matching `<select>` picks the row it should follow; submitting
 * calls {@link setScreenContentSource}. A returned `{ error }` keeps the dialog
 * open and shows a toast; a success closes it and refreshes the screens list.
 */
export function ScreenContentSourceDialog({
  open,
  onOpenChange,
  screen,
  playlists,
  canvases,
}: ScreenContentSourceDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // Canvas first, to match `resolveScreenContent`, which checks the canvas tier
  // before the base playlist.
  const initialSource: Source = screen.canvasId
    ? "canvas"
    : screen.playlistId
      ? "playlist"
      : "none";
  const [source, setSource] = React.useState<Source>(initialSource);
  const [playlistId, setPlaylistId] = React.useState(screen.playlistId ?? "");
  const [canvasId, setCanvasId] = React.useState(screen.canvasId ?? "");

  // The dialog stays mounted between openings, so state seeded at first mount
  // would go stale after a save or a refresh. Re-seed from the props every time
  // it transitions to open, the same way the canvas settings dialog does.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSource(initialSource);
      setPlaylistId(screen.playlistId ?? "");
      setCanvasId(screen.canvasId ?? "");
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input =
      source === "playlist"
        ? { screenId: screen.id, source, playlistId }
        : source === "canvas"
          ? { screenId: screen.id, source, canvasId }
          : { screenId: screen.id, source };

    startTransition(async () => {
      const result = await setScreenContentSource(input);
      if (result && "error" in result) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Content source</DialogTitle>
          <DialogDescription>
            Choose what {screen.name} plays. A screen can follow a playlist, show
            a canvas, or stay empty.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Source</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="content-source"
                checked={source === "playlist"}
                onChange={() => setSource("playlist")}
              />
              Playlist
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="content-source"
                checked={source === "canvas"}
                onChange={() => setSource("canvas")}
              />
              Canvas
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="content-source"
                checked={source === "none"}
                onChange={() => setSource("none")}
              />
              None
            </label>
          </fieldset>

          {source === "playlist" ? (
            <div className="space-y-1.5">
              <label
                htmlFor="content-source-playlist"
                className="text-sm font-medium"
              >
                Playlist to follow
              </label>
              <select
                id="content-source-playlist"
                aria-label="Playlist to follow"
                className={FIELD_CLASS}
                value={playlistId}
                onChange={(event) => setPlaylistId(event.target.value)}
              >
                <option value="">Choose a playlist</option>
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {source === "canvas" ? (
            <div className="space-y-1.5">
              <label
                htmlFor="content-source-canvas"
                className="text-sm font-medium"
              >
                Canvas to show
              </label>
              <select
                id="content-source-canvas"
                aria-label="Canvas to show"
                className={FIELD_CLASS}
                value={canvasId}
                onChange={(event) => setCanvasId(event.target.value)}
              >
                <option value="">Choose a canvas</option>
                {canvases.map((canvas) => (
                  <option key={canvas.id} value={canvas.id}>
                    {canvas.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
