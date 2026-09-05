"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DemoWatermark } from "@/components/app/demo-watermark";

interface PreviewItem {
  id: string;
  kind: "IMAGE" | "VIDEO" | "WEB";
  url: string;
  durationSeconds: number;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

interface PreviewResponse {
  id: string;
  name: string;
  revision: number;
  items: PreviewItem[];
}

export interface PlaylistPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  playlistName: string;
  /**
   * Overrides the manifest path. Defaults to `/api/playlists/${playlistId}/preview`;
   * pass a campaign preview path to play a campaign's playlist through this player.
   */
  fetchPath?: string;
  /** When true, lay a static, non-interactive "Demo" watermark over the play
   * surface. Additive: no layout or playback change. */
  demoWatermark?: boolean;
  /** Optional muted line shown directly under the dialog title. */
  headerNote?: string;
}

const KIND_LABEL: Record<PreviewItem["kind"], string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  WEB: "Web",
};

/** Fallback seconds for an image or web item that resolves to a non-positive
 * duration, so the preview never stalls on one slide. */
const MIN_STILL_SECONDS = 3;

/**
 * Plays a playlist the way a paired screen would. On open it fetches
 * `/api/playlists/[id]/preview` (the shared manifest, session-authed), or the
 * `fetchPath` override when one is given, and steps through the items: images
 * and web pages for their resolved duration, videos to their natural end, then
 * loops. Controls are play/pause, previous/next and a fullscreen toggle.
 * Refetches every time it opens, so it reflects unsaved edits once the editor
 * has refreshed.
 */
export function PlaylistPreviewDialog({
  open,
  onOpenChange,
  playlistId,
  playlistName,
  fetchPath,
  demoWatermark = false,
  headerNote,
}: PlaylistPreviewDialogProps) {
  const [items, setItems] = React.useState<PreviewItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const stageRef = React.useRef<HTMLDivElement>(null);

  // Fetch the manifest each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setItems(null);
      setIndex(0);
      setPlaying(true);
      try {
        const res = await fetch(
          fetchPath ?? `/api/playlists/${playlistId}/preview`,
        );
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as PreviewResponse;
        if (cancelled) return;
        setItems(data.items);
      } catch {
        if (!cancelled) setError("This playlist could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, playlistId, fetchPath]);

  const count = items?.length ?? 0;
  const current = items && count > 0 ? items[index % count] : null;

  const advance = React.useCallback(() => {
    setIndex((i) => (count > 0 ? (i + 1) % count : 0));
  }, [count]);

  const back = React.useCallback(() => {
    setIndex((i) => (count > 0 ? (i - 1 + count) % count : 0));
  }, [count]);

  // Still items (image, web) advance on a timer. Videos advance on `ended`.
  React.useEffect(() => {
    if (!open || !playing || !current || current.kind === "VIDEO") return;
    const seconds =
      current.durationSeconds > 0 ? current.durationSeconds : MIN_STILL_SECONDS;
    const timer = window.setTimeout(advance, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [open, playing, current, advance]);

  // Track fullscreen so the toggle icon and state stay in sync with Esc etc.
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (stageRef.current) {
        await stageRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen can be blocked by the environment; ignore and stay windowed.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Preview {playlistName}</DialogTitle>
          {headerNote ? (
            <p className="text-sm text-muted-foreground">{headerNote}</p>
          ) : null}
          <DialogDescription>
            Plays the items in order, the way an assigned screen would.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={stageRef}
          className="relative overflow-hidden rounded-lg border border-hairline bg-black"
        >
          {loading ? (
            <Skeleton className="aspect-video w-full" />
          ) : error ? (
            <p className="p-10 text-center text-sm text-white">{error}</p>
          ) : count === 0 ? (
            <p className="p-10 text-center text-sm text-white">
              Nothing to preview. Add ready media items and enable them.
            </p>
          ) : current ? (
            <Stage item={current} onEnded={advance} playing={playing} />
          ) : null}

          {current ? (
            <div className="pointer-events-none absolute left-3 top-3">
              <Badge variant="secondary">{KIND_LABEL[current.kind]}</Badge>
            </div>
          ) : null}

          {demoWatermark ? <DemoWatermark /> : null}
        </div>

        {count > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {(index % count) + 1} of {count}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                onClick={back}
                aria-label="Previous item"
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={advance}
                aria-label="Next item"
              >
                <ChevronRight aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize aria-hidden />
                ) : (
                  <Maximize aria-hidden />
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stage({
  item,
  onEnded,
  playing,
}: {
  item: PreviewItem;
  onEnded: () => void;
  playing: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      void el.play().catch(() => {
        // Autoplay may be refused; the operator can use the play control.
      });
    } else {
      el.pause();
    }
  }, [playing, item.url]);

  const cap =
    item.kind === "VIDEO" && item.durationSeconds > 0
      ? item.durationSeconds
      : null;

  if (item.kind === "IMAGE") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={item.id}
        src={item.url}
        alt=""
        className="mx-auto max-h-[70vh] w-full object-contain"
      />
    );
  }

  if (item.kind === "VIDEO") {
    return (
      <video
        key={item.id}
        ref={videoRef}
        src={item.url}
        className="mx-auto max-h-[70vh] w-full bg-black"
        muted
        playsInline
        autoPlay
        onEnded={onEnded}
        onTimeUpdate={(e) => {
          if (cap != null && e.currentTarget.currentTime >= cap) onEnded();
        }}
      />
    );
  }

  return (
    <iframe
      key={item.id}
      src={item.url}
      title="Web content"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={cn("aspect-video w-full bg-white")}
    />
  );
}
