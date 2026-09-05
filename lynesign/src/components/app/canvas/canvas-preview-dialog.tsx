"use client";

import * as React from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DemoWatermark } from "@/components/app/demo-watermark";
import type {
  CanvasManifest,
  CanvasManifestFrame,
} from "@/lib/player/canvas-manifest";

export interface CanvasPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvasId: string;
  /** When true, lay a static, non-interactive "Demo" watermark over the play
   * surface. Additive: no layout or playback change. */
  demoWatermark?: boolean;
  /** Optional muted line shown directly under the dialog title. */
  headerNote?: string;
}

/** Widest the play surface draws inside the dialog; the canvas scales to fit. */
const MAX_STAGE_WIDTH = 760;

/** Fallback seconds for a frame whose manifest duration is not positive, so a
 * panel never stalls forever on a single frame. */
const MIN_FRAME_SECONDS = 3;

/**
 * Plays one canvas the way a paired screen would. On open it fetches
 * `/api/canvas/[id]/preview` (the shared manifest, session-authed) and draws the
 * scaled canvas box with every panel positioned in `zIndex` order. Each panel
 * cycles its own `frames` array on their `durationSeconds`, driven by a
 * per-panel timer keyed off the manifest; a panel with one frame needs no timer.
 * Images and videos render from the presigned URL, web frames in a sandboxed
 * iframe, clocks tick on a one second timer. Controls are pause / resume and
 * restart, which returns every panel to its first frame. A non-OK response
 * shows an inline message instead of the stage.
 */
export function CanvasPreviewDialog({
  open,
  onOpenChange,
  canvasId,
  demoWatermark = false,
  headerNote,
}: CanvasPreviewDialogProps) {
  const [manifest, setManifest] = React.useState<CanvasManifest | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(true);
  const [cursors, setCursors] = React.useState<number[]>([]);
  const [restartNonce, setRestartNonce] = React.useState(0);
  const [now, setNow] = React.useState(() => new Date());

  // Scheduling reads the live cursor positions from a ref, not from `cursors`
  // state, so one panel advancing never re-runs the cycling effect and never
  // reschedules a sibling panel's timer. State is kept in step for rendering.
  const cursorsRef = React.useRef<number[]>([]);
  const setCursorAt = React.useCallback((panelIndex: number, value: number) => {
    const next = [...cursorsRef.current];
    next[panelIndex] = value;
    cursorsRef.current = next;
    setCursors(next);
  }, []);
  const resetCursors = React.useCallback((length: number) => {
    const zeros = Array.from({ length }, () => 0);
    cursorsRef.current = zeros;
    setCursors(zeros);
  }, []);

  // Fetch the manifest each time the dialog opens, so it reflects edits once the
  // editor has refreshed.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setManifest(null);
      resetCursors(0);
      setPlaying(true);
      setRestartNonce(0);
      try {
        const res = await fetch(`/api/canvas/${canvasId}/preview`);
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as CanvasManifest;
        if (cancelled) return;
        setManifest(data);
        resetCursors(data.panels.length);
      } catch {
        if (!cancelled) setError("This canvas could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, canvasId, resetCursors]);

  // Each multi-frame panel runs its own self-rearming timeout: on fire it
  // advances only its own cursor, then schedules its next tick from the new
  // frame's `durationSeconds`. Sibling panels are untouched, so panels with
  // different frame timings never starve each other. The effect re-runs only on
  // open / play / manifest / restart, never on a single panel advancing.
  // Pause and close clear every pending timeout; resume reschedules from the
  // frozen cursor positions; a single-frame panel gets no timer.
  React.useEffect(() => {
    if (!open || !playing || !manifest) return;
    const timers: number[] = [];

    const scheduleNext = (panelIndex: number) => {
      const panel = manifest.panels[panelIndex];
      const count = panel.frames.length;
      if (count <= 1) return;
      const cursor = (cursorsRef.current[panelIndex] ?? 0) % count;
      const frame = panel.frames[cursor];
      const seconds =
        frame.durationSeconds > 0 ? frame.durationSeconds : MIN_FRAME_SECONDS;
      const timer = window.setTimeout(() => {
        setCursorAt(panelIndex, (cursor + 1) % count);
        scheduleNext(panelIndex);
      }, seconds * 1000);
      timers.push(timer);
    };

    manifest.panels.forEach((_, panelIndex) => scheduleNext(panelIndex));

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [open, playing, manifest, restartNonce, setCursorAt]);

  // A one second tick for the clock frames, live only while the dialog is open.
  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  function restart() {
    resetCursors(manifest ? manifest.panels.length : 0);
    setPlaying(true);
    setRestartNonce((n) => n + 1);
  }

  const scale = manifest
    ? Math.min(1, MAX_STAGE_WIDTH / manifest.width)
    : 1;
  const hasPanels = manifest != null && manifest.panels.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Play canvas</DialogTitle>
          {headerNote ? (
            <p className="text-sm text-muted-foreground">{headerNote}</p>
          ) : null}
          <DialogDescription>
            Plays every panel on its own frame timing, the way an assigned screen
            would.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Skeleton className="mx-auto aspect-video w-full max-w-[760px]" />
        ) : error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {error}
          </p>
        ) : !hasPanels ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            This canvas has no panels to play yet.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-auto rounded-lg border border-hairline bg-canvas p-3">
              <div
                className="relative mx-auto overflow-hidden"
                style={{
                  width: manifest.width * scale,
                  height: manifest.height * scale,
                  backgroundColor: manifest.background.color ?? "#000000",
                  backgroundImage: manifest.background.imageUrl
                    ? `url(${manifest.background.imageUrl})`
                    : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                {manifest.panels.map((panel, panelIndex) => {
                  const count = panel.frames.length;
                  const cursor = count > 0 ? (cursors[panelIndex] ?? 0) % count : 0;
                  const frame = panel.frames[cursor];
                  return (
                    <div
                      key={panel.id}
                      className="absolute overflow-hidden"
                      style={{
                        left: panel.x * scale,
                        top: panel.y * scale,
                        width: panel.width * scale,
                        height: panel.height * scale,
                        zIndex: panel.zIndex,
                      }}
                    >
                      <FrameView
                        key={`${panel.id}-${cursor}-${restartNonce}`}
                        frame={frame}
                        now={now}
                      />
                    </div>
                  );
                })}
                {demoWatermark ? <DemoWatermark /> : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                {playing ? "Pause" : "Resume"}
              </Button>
              <Button variant="outline" size="sm" onClick={restart}>
                <RotateCcw aria-hidden />
                Restart
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** CSS `object-fit` for a picture frame's stored `mode`. Unknown modes fit. */
function objectFitFor(
  mode: string | null | undefined,
): React.CSSProperties["objectFit"] {
  switch (mode) {
    case "fill":
      return "cover";
    case "stretch":
      return "fill";
    case "fit":
      return "contain";
    default:
      return "contain";
  }
}

function FrameView({
  frame,
  now,
}: {
  frame: CanvasManifestFrame | undefined;
  now: Date;
}) {
  if (!frame) return null;

  switch (frame.kind) {
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame.image?.url}
          alt=""
          className="h-full w-full"
          style={{ objectFit: objectFitFor(frame.image?.mode) }}
        />
      );
    case "video":
      return (
        <video
          src={frame.video?.url}
          className="h-full w-full bg-black object-contain"
          muted
          playsInline
          autoPlay
          loop
        />
      );
    case "text":
      return (
        <div className="flex h-full w-full items-center justify-center overflow-auto bg-white p-3 text-center text-sm text-ink">
          <p className="whitespace-pre-wrap">{frame.text?.body}</p>
        </div>
      );
    case "web":
      return (
        <iframe
          src={frame.web?.url}
          title="Web frame"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
        />
      );
    case "clock":
      return <ClockView clock={frame.clock} now={now} />;
    default:
      return null;
  }
}

/** A ticking clock frame. Shape comes from date-fns, the zone shift from `Intl`,
 * mirroring the static editor preview. */
function ClockView({
  clock,
  now,
}: {
  clock: NonNullable<CanvasManifestFrame["clock"]> | undefined;
  now: Date;
}) {
  if (!clock) return null;

  let zoned = now;
  if (clock.timeZone) {
    try {
      const shifted = new Date(
        now.toLocaleString("en-US", { timeZone: clock.timeZone }),
      );
      if (!Number.isNaN(shifted.getTime())) zoned = shifted;
    } catch {
      zoned = now;
    }
  }

  const parts: string[] = [];
  if (clock.label && clock.label.trim()) parts.push(clock.label.trim());
  if (clock.showDate) parts.push(format(zoned, "EEEE, d MMMM yyyy"));
  if (clock.showTime) {
    parts.push(format(zoned, clock.showSeconds ? "HH:mm:ss" : "HH:mm"));
  }
  const text = parts.length > 0 ? parts.join("  |  ") : "Clock";

  return (
    <div
      data-clock-style={clock.style}
      className="flex h-full w-full items-center justify-center bg-navy p-2 text-center font-medium text-white"
    >
      <span>{text}</span>
    </div>
  );
}
