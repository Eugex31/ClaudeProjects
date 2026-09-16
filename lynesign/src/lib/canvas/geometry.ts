/**
 * Pure canvas geometry helpers for the visual editor.
 *
 * Every function here is deterministic and free of DOM, I/O, time and
 * randomness so the drag, resize, snap and alignment behaviour can be unit
 * tested without a browser. All values are in canvas pixels.
 */

export const MIN_PANEL = 16;
export const SNAP_TOLERANCE = 8;
export const DEFAULT_GRID = 8;

export type Rect = { x: number; y: number; width: number; height: number };

export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

/**
 * Round `value` to the nearest multiple of `grid`. A `grid` of 1 or less is a
 * passthrough, which is how the editor turns snapping off. Works for negative
 * values and always returns positive zero rather than negative zero.
 */
export function snap(value: number, grid: number): number {
  if (grid <= 1) return value;
  const snapped = Math.round(value / grid) * grid;
  return snapped === 0 ? 0 : snapped;
}

/**
 * Keep a panel usable: force `width` and `height` to at least `MIN_PANEL`, then
 * keep at least `MIN_PANEL` px of the panel inside the canvas on every edge. A
 * panel may still hang off an edge, it just cannot leave the canvas entirely.
 * Returns a new `Rect`.
 */
export function clampPanel(
  rect: Rect,
  canvas: { width: number; height: number },
): Rect {
  const width = Math.max(rect.width, MIN_PANEL);
  const height = Math.max(rect.height, MIN_PANEL);

  const minX = MIN_PANEL - width;
  const maxX = canvas.width - MIN_PANEL;
  const minY = MIN_PANEL - height;
  const maxY = canvas.height - MIN_PANEL;

  const x = Math.min(Math.max(rect.x, minX), maxX);
  const y = Math.min(Math.max(rect.y, minY), maxY);

  return { x, y, width, height };
}

type EdgeTarget = { coord: number; spanMin: number; spanMax: number };

type AxisMatch = { delta: number; at: number; from: number; to: number };

function bestAxisMatch(
  edges: number[],
  targets: EdgeTarget[],
  movingSpanMin: number,
  movingSpanMax: number,
  tolerance: number,
): AxisMatch | null {
  let best: AxisMatch | null = null;

  for (const edge of edges) {
    for (const target of targets) {
      const delta = target.coord - edge;
      if (Math.abs(delta) > tolerance) continue;

      const better =
        best === null ||
        Math.abs(delta) < Math.abs(best.delta) ||
        (Math.abs(delta) === Math.abs(best.delta) && target.coord < best.at);

      if (better) {
        best = {
          delta,
          at: target.coord,
          from: Math.min(movingSpanMin, target.spanMin),
          to: Math.max(movingSpanMax, target.spanMax),
        };
      }
    }
  }

  return best;
}

/**
 * Find the single closest alignment snap per axis for `moving` against every
 * rect in `others` and against the canvas edges and centre lines.
 *
 * On the x axis the moving left, centre-x and right edges are compared with
 * each other rect's left, centre-x and right and with the canvas left (0),
 * centre-x (`canvas.width / 2`) and right (`canvas.width`); the y axis is the
 * same with top, centre-y and bottom against 0, `canvas.height / 2` and
 * `canvas.height`. The smallest magnitude candidate within `tolerance` wins,
 * with ties broken towards the lower candidate coordinate.
 *
 * Returns `dx` / `dy`, the offset to add to `moving.x` / `moving.y` (0 when
 * nothing is within tolerance), and one `Guide` per axis that snapped. An
 * `axis: "x"` guide is a vertical line at the snapped x whose `from` / `to`
 * span the union of the moving and matched rects' y range, and the mirror for
 * `axis: "y"`.
 */
export function alignmentGuides(
  moving: Rect,
  others: Rect[],
  canvas: { width: number; height: number },
  tolerance: number,
): { dx: number; dy: number; guides: Guide[] } {
  const movingLeft = moving.x;
  const movingRight = moving.x + moving.width;
  const movingTop = moving.y;
  const movingBottom = moving.y + moving.height;

  const xEdges = [movingLeft, moving.x + moving.width / 2, movingRight];
  const yEdges = [movingTop, moving.y + moving.height / 2, movingBottom];

  const xTargets: EdgeTarget[] = [];
  const yTargets: EdgeTarget[] = [];

  for (const other of others) {
    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oBottom = other.y + other.height;

    for (const coord of [oLeft, other.x + other.width / 2, oRight]) {
      xTargets.push({ coord, spanMin: oTop, spanMax: oBottom });
    }
    for (const coord of [oTop, other.y + other.height / 2, oBottom]) {
      yTargets.push({ coord, spanMin: oLeft, spanMax: oRight });
    }
  }

  for (const coord of [0, canvas.width / 2, canvas.width]) {
    xTargets.push({ coord, spanMin: 0, spanMax: canvas.height });
  }
  for (const coord of [0, canvas.height / 2, canvas.height]) {
    yTargets.push({ coord, spanMin: 0, spanMax: canvas.width });
  }

  const xMatch = bestAxisMatch(xEdges, xTargets, movingTop, movingBottom, tolerance);
  const yMatch = bestAxisMatch(yEdges, yTargets, movingLeft, movingRight, tolerance);

  const guides: Guide[] = [];
  if (xMatch) {
    guides.push({ axis: "x", at: xMatch.at, from: xMatch.from, to: xMatch.to });
  }
  if (yMatch) {
    guides.push({ axis: "y", at: yMatch.at, from: yMatch.from, to: yMatch.to });
  }

  return {
    dx: xMatch ? xMatch.delta : 0,
    dy: yMatch ? yMatch.delta : 0,
    guides,
  };
}

/**
 * The z-index to give a newly created panel: one above the current top, or 0
 * when there are no panels yet.
 */
export function nextZIndex(panels: { zIndex: number }[]): number {
  if (panels.length === 0) return 0;
  return Math.max(...panels.map((p) => p.zIndex)) + 1;
}

/**
 * Move one panel one step through the z order by swapping its `zIndex` with its
 * nearest neighbour in the chosen direction, where "forward" is towards a
 * higher zIndex. Returns a new array. When the target is already at that end
 * or is not found, the result is a new array with the same content.
 */
export function swapZ<T extends { id: string; zIndex: number }>(
  panels: T[],
  id: string,
  dir: "forward" | "back",
): T[] {
  const target = panels.find((p) => p.id === id);
  if (!target) return panels.slice();

  let neighbour: T | undefined;
  for (const panel of panels) {
    if (panel === target) continue;
    if (dir === "forward") {
      if (
        panel.zIndex > target.zIndex &&
        (neighbour === undefined || panel.zIndex < neighbour.zIndex)
      ) {
        neighbour = panel;
      }
    } else if (
      panel.zIndex < target.zIndex &&
      (neighbour === undefined || panel.zIndex > neighbour.zIndex)
    ) {
      neighbour = panel;
    }
  }

  if (neighbour === undefined) return panels.slice();

  const matched = neighbour;
  const targetZ = target.zIndex;
  const neighbourZ = matched.zIndex;

  return panels.map((panel) => {
    if (panel === target) return { ...panel, zIndex: neighbourZ };
    if (panel === matched) return { ...panel, zIndex: targetZ };
    return panel;
  });
}
