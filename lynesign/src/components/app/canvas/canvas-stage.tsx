"use client";

import * as React from "react";

import type { Guide } from "@/lib/canvas/geometry";

/** The frame `type` discriminator, mirrored from the Prisma `FrameType` enum. */
export type FrameKind =
  | "CLOCK"
  | "PICTURE"
  | "VIDEO"
  | "YOUTUBE"
  | "HTML"
  | "MEMO"
  | "OUTLOOK"
  | "REPORT"
  | "POWERBI"
  | "WEATHER"
  | "NEWS"
  | "WEB";

export interface ClockVM {
  type: number;
  showDate: boolean;
  showTime: boolean;
  showSeconds: boolean;
  label: string | null;
  timeZone: string | null;
}

export interface PictureVM {
  mediaRef: string | null;
  mode: string | null;
  mediaAssetId: string | null;
}

export interface VideoVM {
  mediaRef: string | null;
  mediaAssetId: string | null;
}

export interface MemoVM {
  body: string;
}

export interface WebVM {
  url: string;
}

/** One frame's content row with only the fields the editor and its Task 13
 * content editors read. Empty relations come across as `null`. */
export interface FrameContentVM {
  id: string;
  name: string | null;
  clock: ClockVM | null;
  picture: PictureVM | null;
  video: VideoVM | null;
  memo: MemoVM | null;
  web: WebVM | null;
}

export interface FrameVM {
  id: string;
  sortOrder: number;
  durationSeconds: number;
  type: FrameKind;
  locationScoped: boolean;
  /** ISO string. No `Date` crosses the server boundary. */
  createdAt: string;
  content: FrameContentVM | null;
}

/** A panel as the editor holds it: canvas-pixel geometry plus its frames. */
export interface PanelVM {
  id: string;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  noScroll: boolean;
  frames: FrameVM[];
}

export interface StageCanvas {
  width: number;
  height: number;
  backgroundColor: string | null;
  backgroundImageUrl: string | null;
}

export type StageMode = "edit" | "thumb" | "play";

/** The eight resize grips, named by the compass edge they pull. */
export const RESIZE_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export interface CanvasStageProps {
  canvas: StageCanvas;
  panels: PanelVM[];
  /** Canvas-pixel to screen-pixel ratio. Every rect is multiplied by this. */
  scale: number;
  selectedPanelId: string | null;
  gridSize: number;
  showGrid: boolean;
  guides: Guide[];
  mode: StageMode;
  onPanelPointerDown?: (panelId: string, e: React.PointerEvent) => void;
  /**
   * Resize-grip pointer-down. Not in the original prop list but the eight grips
   * need their own channel to tell the editor which edge is moving; kept
   * optional so `mode: "play"` and `mode: "thumb"` can ignore it.
   */
  onResizeHandlePointerDown?: (
    panelId: string,
    handle: ResizeHandle,
    e: React.PointerEvent,
  ) => void;
  renderFrame?: (panel: PanelVM) => React.ReactNode;
}

const HANDLE_STYLE: Record<ResizeHandle, React.CSSProperties> = {
  nw: { top: -4, left: -4, cursor: "nwse-resize" },
  n: { top: -4, left: "calc(50% - 4px)", cursor: "ns-resize" },
  ne: { top: -4, right: -4, cursor: "nesw-resize" },
  e: { top: "calc(50% - 4px)", right: -4, cursor: "ew-resize" },
  se: { bottom: -4, right: -4, cursor: "nwse-resize" },
  s: { bottom: -4, left: "calc(50% - 4px)", cursor: "ns-resize" },
  sw: { bottom: -4, left: -4, cursor: "nesw-resize" },
  w: { top: "calc(50% - 4px)", left: -4, cursor: "ew-resize" },
};

/**
 * Presentational canvas surface. It draws the scaled canvas box, an optional
 * grid, every panel as an absolutely positioned div in `zIndex` order, the
 * alignment guides passed in during a drag, and whatever `renderFrame` returns
 * inside each panel. It calls no actions and holds no editor state, so Task 14
 * can reuse it inside the preview dialog with `mode: "play"`.
 */
export function CanvasStage({
  canvas,
  panels,
  scale,
  selectedPanelId,
  gridSize,
  showGrid,
  guides,
  mode,
  onPanelPointerDown,
  onResizeHandlePointerDown,
  renderFrame,
}: CanvasStageProps) {
  const boxWidth = canvas.width * scale;
  const boxHeight = canvas.height * scale;
  const step = gridSize * scale;
  const gridVisible = showGrid && step >= 3;

  const ordered = React.useMemo(
    () => [...panels].sort((a, b) => a.zIndex - b.zIndex),
    [panels],
  );

  return (
    <div
      data-testid="canvas-stage"
      className="relative overflow-hidden rounded-panel border border-hairline"
      style={{
        width: boxWidth,
        height: boxHeight,
        backgroundColor: canvas.backgroundColor ?? "#ffffff",
        backgroundImage: canvas.backgroundImageUrl
          ? `url(${canvas.backgroundImageUrl})`
          : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {gridVisible ? (
        <div
          data-testid="canvas-grid"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(15,23,42,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.12) 1px, transparent 1px)",
            backgroundSize: `${step}px ${step}px`,
          }}
        />
      ) : null}

      {ordered.map((panel) => {
        const selected = mode === "edit" && panel.id === selectedPanelId;
        return (
          <div
            key={panel.id}
            data-panel-id={panel.id}
            className="absolute box-border"
            style={{
              left: panel.x * scale,
              top: panel.y * scale,
              width: panel.width * scale,
              height: panel.height * scale,
              zIndex: panel.zIndex,
              outline: selected
                ? "2px solid var(--ring, #4f46e5)"
                : mode === "edit"
                  ? "1px solid rgba(15,23,42,0.18)"
                  : "none",
              touchAction: "none",
            }}
            onPointerDown={
              mode === "edit" && onPanelPointerDown
                ? (e) => onPanelPointerDown(panel.id, e)
                : undefined
            }
          >
            {renderFrame ? renderFrame(panel) : null}

            {selected
              ? RESIZE_HANDLES.map((handle) => (
                  <div
                    key={handle}
                    data-handle={handle}
                    className="absolute size-2 rounded-[2px] border border-white bg-[var(--ring,#4f46e5)]"
                    style={HANDLE_STYLE[handle]}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onResizeHandlePointerDown?.(panel.id, handle, e);
                    }}
                  />
                ))
              : null}
          </div>
        );
      })}

      {guides.map((guide, index) =>
        guide.axis === "x" ? (
          <div
            key={`x-${index}`}
            data-guide="x"
            className="pointer-events-none absolute bg-[#e5484d]"
            style={{
              left: guide.at * scale,
              top: guide.from * scale,
              width: 1,
              height: (guide.to - guide.from) * scale,
            }}
          />
        ) : (
          <div
            key={`y-${index}`}
            data-guide="y"
            className="pointer-events-none absolute bg-[#e5484d]"
            style={{
              top: guide.at * scale,
              left: guide.from * scale,
              height: 1,
              width: (guide.to - guide.from) * scale,
            }}
          />
        ),
      )}
    </div>
  );
}
