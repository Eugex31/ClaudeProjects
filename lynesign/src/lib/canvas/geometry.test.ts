import { describe, it, expect } from "vitest";
import {
  MIN_PANEL,
  SNAP_TOLERANCE,
  DEFAULT_GRID,
  snap,
  clampPanel,
  alignmentGuides,
  nextZIndex,
  swapZ,
  type Rect,
} from "@/lib/canvas/geometry";

describe("constants", () => {
  it("exposes the canvas px constants", () => {
    expect(MIN_PANEL).toBe(16);
    expect(SNAP_TOLERANCE).toBe(8);
    expect(DEFAULT_GRID).toBe(8);
  });
});

describe("snap", () => {
  it("rounds to the nearest multiple of grid", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(13, 8)).toBe(16);
    expect(snap(16, 8)).toBe(16);
  });

  it("handles negatives and returns positive zero", () => {
    expect(snap(-3, 8)).toBe(0);
    expect(Object.is(snap(-3, 8), 0)).toBe(true);
    expect(snap(-13, 8)).toBe(-16);
    expect(snap(-14, 8)).toBe(-16);
  });

  it("passes the value through when grid disables snapping", () => {
    expect(snap(11, 1)).toBe(11);
    expect(snap(11, 0)).toBe(11);
    expect(snap(-13, 1)).toBe(-13);
  });
});

describe("clampPanel", () => {
  const canvas = { width: 1920, height: 1080 };

  it("enforces the minimum panel size", () => {
    const out = clampPanel({ x: 50, y: 50, width: 10, height: 10 }, canvas);
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
    expect(out.x).toBe(50);
    expect(out.y).toBe(50);
  });

  it("keeps MIN_PANEL px visible on the left edge", () => {
    const rect: Rect = { x: -100, y: 50, width: 100, height: 100 };
    const out = clampPanel(rect, canvas);
    expect(out.x).toBe(MIN_PANEL - rect.width);
  });

  it("keeps MIN_PANEL px visible on the top edge", () => {
    const out = clampPanel({ x: 50, y: -100, width: 100, height: 100 }, canvas);
    expect(out.y).toBe(MIN_PANEL - 100);
  });

  it("returns a fully inside rect unchanged", () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
    const out = clampPanel(rect, canvas);
    expect(out).toEqual(rect);
    expect(out).not.toBe(rect);
  });

  it("allows a panel to hang off the right edge", () => {
    const out = clampPanel({ x: 1900, y: 100, width: 100, height: 100 }, canvas);
    expect(out.x).toBe(1900);
  });

  it("pulls a panel back when less than MIN_PANEL would stay visible on the right", () => {
    const out = clampPanel({ x: 1910, y: 100, width: 100, height: 100 }, canvas);
    expect(out.x).toBe(canvas.width - MIN_PANEL);
  });
});

describe("alignmentGuides", () => {
  const canvas = { width: 1920, height: 1080 };

  it("snaps the left edge to another rect's left edge", () => {
    const other: Rect = { x: 200, y: 0, width: 1000, height: 50 };
    const moving: Rect = { x: 203, y: 400, width: 50, height: 50 };
    const res = alignmentGuides(moving, [other], canvas, 8);
    expect(res.dx).toBe(-3);
    expect(res.dy).toBe(0);
    expect(res.guides).toHaveLength(1);
    expect(res.guides[0].axis).toBe("x");
    expect(res.guides[0].at).toBe(200);
  });

  it("snaps center-x to the canvas center", () => {
    const moving: Rect = { x: 912, y: 100, width: 100, height: 100 };
    const res = alignmentGuides(moving, [], canvas, 8);
    expect(res.dx).toBe(-2);
    expect(res.guides).toHaveLength(1);
    expect(res.guides[0].axis).toBe("x");
    expect(res.guides[0].at).toBe(canvas.width / 2);
  });

  it("returns no snap when everything is out of tolerance", () => {
    const other: Rect = { x: 0, y: 0, width: 50, height: 50 };
    const moving: Rect = { x: 70, y: 70, width: 50, height: 50 };
    const res = alignmentGuides(moving, [other], canvas, 8);
    expect(res.dx).toBe(0);
    expect(res.dy).toBe(0);
    expect(res.guides).toEqual([]);
  });

  it("snaps x and y independently in one call", () => {
    const other: Rect = { x: 200, y: 300, width: 1000, height: 1000 };
    const moving: Rect = { x: 203, y: 305, width: 50, height: 50 };
    const res = alignmentGuides(moving, [other], canvas, 8);
    expect(res.dx).toBe(-3);
    expect(res.dy).toBe(-5);
    expect(res.guides).toHaveLength(2);
    const xGuide = res.guides.find((g) => g.axis === "x");
    const yGuide = res.guides.find((g) => g.axis === "y");
    expect(xGuide?.at).toBe(200);
    expect(yGuide?.at).toBe(300);
  });

  it("breaks ties by picking the lower candidate coordinate", () => {
    const a: Rect = { x: 103, y: 0, width: 1000, height: 10 };
    const b: Rect = { x: 97, y: 200, width: 1000, height: 10 };
    const moving: Rect = { x: 100, y: 100, width: 50, height: 50 };
    const res = alignmentGuides(moving, [a, b], canvas, 8);
    expect(res.dx).toBe(-3);
    expect(res.guides).toHaveLength(1);
    expect(res.guides[0].at).toBe(97);
  });

  it("spans the guide across the union of the moving and matched rects", () => {
    const other: Rect = { x: 200, y: 0, width: 1000, height: 50 };
    const moving: Rect = { x: 203, y: 400, width: 50, height: 50 };
    const res = alignmentGuides(moving, [other], canvas, 8);
    expect(res.guides[0].from).toBe(0);
    expect(res.guides[0].to).toBe(450);
  });
});

describe("nextZIndex", () => {
  it("returns 0 for an empty array", () => {
    expect(nextZIndex([])).toBe(0);
  });

  it("returns max + 1", () => {
    expect(nextZIndex([{ zIndex: 0 }, { zIndex: 5 }])).toBe(6);
    expect(nextZIndex([{ zIndex: -5 }, { zIndex: -1 }])).toBe(0);
  });
});

describe("swapZ", () => {
  const base = () => [
    { id: "a", zIndex: 0 },
    { id: "b", zIndex: 1 },
    { id: "c", zIndex: 2 },
  ];

  it("is a no-op moving the top panel forward", () => {
    const panels = base();
    const out = swapZ(panels, "c", "forward");
    expect(out).not.toBe(panels);
    expect(out).toEqual(panels);
  });

  it("is a no-op moving the bottom panel back", () => {
    const panels = base();
    const out = swapZ(panels, "a", "back");
    expect(out).not.toBe(panels);
    expect(out).toEqual(panels);
  });

  it("is a no-op for an unknown id", () => {
    const panels = base();
    const out = swapZ(panels, "zzz", "forward");
    expect(out).not.toBe(panels);
    expect(out).toEqual(panels);
  });

  it("swaps a middle panel with its forward neighbour", () => {
    const panels = base();
    const out = swapZ(panels, "b", "forward");
    expect(out).not.toBe(panels);
    expect(out.find((p) => p.id === "b")?.zIndex).toBe(2);
    expect(out.find((p) => p.id === "c")?.zIndex).toBe(1);
    expect(out.find((p) => p.id === "a")?.zIndex).toBe(0);
    expect(panels.find((p) => p.id === "b")?.zIndex).toBe(1);
  });

  it("swaps a middle panel with its backward neighbour", () => {
    const panels = base();
    const out = swapZ(panels, "b", "back");
    expect(out.find((p) => p.id === "b")?.zIndex).toBe(0);
    expect(out.find((p) => p.id === "a")?.zIndex).toBe(1);
    expect(out.find((p) => p.id === "c")?.zIndex).toBe(2);
  });

  it("uses the nearest neighbour in zIndex order, not array order", () => {
    const panels = [
      { id: "a", zIndex: 10 },
      { id: "b", zIndex: 30 },
      { id: "c", zIndex: 20 },
    ];
    const out = swapZ(panels, "a", "forward");
    expect(out.find((p) => p.id === "a")?.zIndex).toBe(20);
    expect(out.find((p) => p.id === "c")?.zIndex).toBe(10);
    expect(out.find((p) => p.id === "b")?.zIndex).toBe(30);
  });
});
