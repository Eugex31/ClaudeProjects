import * as React from "react";

import {
  SNAP_TOLERANCE,
  alignmentGuides,
  clampPanel,
  snap,
  type Guide,
  type Rect,
} from "@/lib/canvas/geometry";
import type { PanelVM, ResizeHandle } from "./canvas-stage";

/** The subset of a panel a drag or resize can commit. Move sends `x`/`y`;
 * resize adds `width`/`height`. */
export type PanelPatch = Partial<Pick<PanelVM, "x" | "y" | "width" | "height">>;

/** Screen-pixel distance the pointer must travel before a press becomes a drag.
 * A press that never crosses it selects the panel and commits nothing. */
const DRAG_THRESHOLD = 3;

interface UseCanvasDragArgs {
  canvasSize: { width: number; height: number };
  scale: number;
  gridSize: number;
  panels: PanelVM[];
  /** When true the grips and panel body do not start a drag. */
  disabled: boolean;
  /** Apply an optimistic change to the editor's panel array. */
  onPanelsChange: (updater: (panels: PanelVM[]) => PanelVM[]) => void;
  /**
   * Persist one panel once a real drag ends. `origin` is the panel's rect at
   * pointer-down, so a failed save reverts to the true start, not the drop.
   */
  onCommit: (id: string, patch: PanelPatch, origin: Rect) => void;
}

interface UseCanvasDragResult {
  guides: Guide[];
  onPanelPointerDown: (panelId: string, e: React.PointerEvent) => void;
  onResizeHandlePointerDown: (
    panelId: string,
    handle: ResizeHandle,
    e: React.PointerEvent,
  ) => void;
}

interface DragSession {
  panelId: string;
  handle: ResizeHandle | null;
  startPointer: { x: number; y: number };
  startRect: Rect;
  current: Rect;
  /** Flips true once the pointer clears `DRAG_THRESHOLD`. Until then the press
   * is a plain click. */
  dragging: boolean;
}

const toRect = (panel: PanelVM): Rect => ({
  x: panel.x,
  y: panel.y,
  width: panel.width,
  height: panel.height,
});

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Move the edges named by `handle` by the pointer delta, in canvas pixels. */
function applyResize(rect: Rect, handle: ResizeHandle, dx: number, dy: number): Rect {
  let { x, y, width, height } = rect;
  if (handle.includes("e")) width = rect.width + dx;
  if (handle.includes("s")) height = rect.height + dy;
  if (handle.includes("w")) {
    x = rect.x + dx;
    width = rect.width - dx;
  }
  if (handle.includes("n")) {
    y = rect.y + dy;
    height = rect.height - dy;
  }
  return { x, y, width, height };
}

/** Snap only the edges the grip is dragging to the grid, leaving the anchored
 * edges where they are. */
function snapResizeEdges(rect: Rect, handle: ResizeHandle, grid: number): Rect {
  let { x, y, width, height } = rect;
  if (handle.includes("w")) {
    const nextX = snap(x, grid);
    width += x - nextX;
    x = nextX;
  }
  if (handle.includes("n")) {
    const nextY = snap(y, grid);
    height += y - nextY;
    y = nextY;
  }
  if (handle.includes("e")) width = snap(x + width, grid) - x;
  if (handle.includes("s")) height = snap(y + height, grid) - y;
  return { x, y, width, height };
}

/**
 * Pointer-drag and resize behaviour for `<CanvasStage>` panels, split out of
 * `<CanvasEditor>` to keep that file readable. It owns the transient drag
 * session and the alignment guides, translates the pointer delta by `1 / scale`,
 * runs `snap` then `alignmentGuides` on every move, `clampPanel` on release, and
 * hands the final rect back through `onCommit` only when the geometry actually
 * changed. Window listeners are used so a fast drag that leaves the panel does
 * not drop the gesture, and they are torn down on unmount if a drag is still in
 * flight.
 */
export function useCanvasDrag(args: UseCanvasDragArgs): UseCanvasDragResult {
  const [guides, setGuides] = React.useState<Guide[]>([]);
  const sessionRef = React.useRef<DragSession | null>(null);
  const listenersRef = React.useRef<{
    move: (ev: PointerEvent) => void;
    up: (ev: PointerEvent) => void;
  } | null>(null);

  // A ref of the latest args so the window listeners, bound once per gesture,
  // always read the current scale, grid and sibling panels.
  const argsRef = React.useRef(args);
  React.useEffect(() => {
    argsRef.current = args;
  });

  const detach = React.useCallback(() => {
    if (!listenersRef.current) return;
    window.removeEventListener("pointermove", listenersRef.current.move);
    window.removeEventListener("pointerup", listenersRef.current.up);
    listenersRef.current = null;
  }, []);

  // Drop a half-finished gesture if the editor unmounts mid-drag.
  React.useEffect(() => detach, [detach]);

  const begin = React.useCallback(
    (panelId: string, handle: ResizeHandle | null, e: React.PointerEvent) => {
      const live = argsRef.current;
      if (live.disabled) return;
      const panel = live.panels.find((p) => p.id === panelId);
      if (!panel) return;
      e.preventDefault();

      const startRect = toRect(panel);
      const session: DragSession = {
        panelId,
        handle,
        startPointer: { x: e.clientX, y: e.clientY },
        startRect,
        current: startRect,
        dragging: false,
      };
      sessionRef.current = session;

      function onMove(ev: PointerEvent) {
        const s = sessionRef.current;
        if (!s) return;
        const now = argsRef.current;
        const pointerDx = ev.clientX - s.startPointer.x;
        const pointerDy = ev.clientY - s.startPointer.y;

        if (!s.dragging) {
          if (Math.hypot(pointerDx, pointerDy) < DRAG_THRESHOLD) return;
          s.dragging = true;
        }

        const dx = pointerDx / now.scale;
        const dy = pointerDy / now.scale;

        let rect: Rect = s.handle
          ? applyResize(s.startRect, s.handle, dx, dy)
          : { ...s.startRect, x: s.startRect.x + dx, y: s.startRect.y + dy };

        rect = s.handle
          ? snapResizeEdges(rect, s.handle, now.gridSize)
          : {
              ...rect,
              x: snap(rect.x, now.gridSize),
              y: snap(rect.y, now.gridSize),
            };

        const others = now.panels
          .filter((p) => p.id !== s.panelId)
          .map(toRect);
        const align = alignmentGuides(
          rect,
          others,
          now.canvasSize,
          SNAP_TOLERANCE,
        );

        // A move snaps by translating the whole rect onto the guide. A resize
        // only shows the guide: translating would drag the anchored edge too.
        if (!s.handle) {
          rect = { ...rect, x: rect.x + align.dx, y: rect.y + align.dy };
        }

        s.current = rect;
        setGuides(align.guides);
        now.onPanelsChange((panels) =>
          panels.map((p) => (p.id === s.panelId ? { ...p, ...rect } : p)),
        );
      }

      function onUp() {
        detach();
        const s = sessionRef.current;
        sessionRef.current = null;
        setGuides([]);
        // A press with no travel is a select, not a drag: commit nothing.
        if (!s || !s.dragging) return;

        const now = argsRef.current;
        const clamped = clampPanel(s.current, now.canvasSize);

        if (sameRect(clamped, s.startRect)) {
          // Dragged back to where it started: settle local state, save nothing.
          now.onPanelsChange((panels) =>
            panels.map((p) =>
              p.id === s.panelId ? { ...p, ...s.startRect } : p,
            ),
          );
          return;
        }

        now.onPanelsChange((panels) =>
          panels.map((p) =>
            p.id === s.panelId ? { ...p, ...clamped } : p,
          ),
        );
        const patch: PanelPatch = s.handle
          ? {
              x: clamped.x,
              y: clamped.y,
              width: clamped.width,
              height: clamped.height,
            }
          : { x: clamped.x, y: clamped.y };
        now.onCommit(s.panelId, patch, s.startRect);
      }

      detach();
      listenersRef.current = { move: onMove, up: onUp };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [detach],
  );

  const onPanelPointerDown = React.useCallback(
    (panelId: string, e: React.PointerEvent) => begin(panelId, null, e),
    [begin],
  );

  const onResizeHandlePointerDown = React.useCallback(
    (panelId: string, handle: ResizeHandle, e: React.PointerEvent) =>
      begin(panelId, handle, e),
    [begin],
  );

  return { guides, onPanelPointerDown, onResizeHandlePointerDown };
}
