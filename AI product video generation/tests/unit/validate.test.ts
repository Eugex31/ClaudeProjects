import { describe, expect, test } from "vitest";
import { validateStoryboard } from "@/lib/storyboard/validate";
import type { PartManifest } from "@/lib/storyboard/types";

const manifest: PartManifest = [
  { id: "side_left", label: "Left side", size: [0.02, 1, 0.3], center: [-0.4, 0.5, 0] },
  { id: "side_right", label: "Right side", size: [0.02, 1, 0.3], center: [0.4, 0.5, 0] },
  { id: "shelf_1", label: "Shelf", size: [0.8, 0.02, 0.3], center: [0, 0.3, 0] },
];

describe("validateStoryboard", () => {
  test("keeps a valid step unchanged", () => {
    const { steps, issues } = validateStoryboard(
      [{ id: "s1", title: "Sides", narration: "Stand the sides up.", parts: ["side_left", "side_right"], from: "left", camera: "iso" }],
      manifest,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].parts).toEqual(["side_left", "side_right"]);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  test("drops unknown part ids and reports them", () => {
    const { steps, issues } = validateStoryboard(
      [{ id: "s1", title: "T", narration: "N", parts: ["side_left", "screw_99"], from: "left", camera: "iso" }],
      manifest,
    );
    expect(steps[0].parts).toEqual(["side_left"]);
    expect(issues.some((i) => i.message.includes("screw_99") && i.stepId === "s1")).toBe(true);
  });

  test("clamps text and fills defaults for bad enums and missing ids", () => {
    const { steps } = validateStoryboard(
      [{ title: "x".repeat(100), narration: "y".repeat(400), parts: ["shelf_1"], from: "sideways", camera: 7, warning: "w".repeat(300) }],
      manifest,
    );
    expect(steps[0].title).toHaveLength(60);
    expect(steps[0].narration).toHaveLength(300);
    expect(steps[0].warning).toHaveLength(200);
    expect(steps[0].from).toBe("above");
    expect(steps[0].camera).toBe("iso");
    expect(steps[0].id).toMatch(/^step_/);
  });

  test("skips non-object entries", () => {
    const { steps, issues } = validateStoryboard([null, 42, "x"], manifest);
    expect(steps).toEqual([]);
    expect(issues.some((i) => i.level === "error" && i.message.includes("no steps"))).toBe(true);
  });

  test("warns about parts never placed and parts placed twice", () => {
    const { issues } = validateStoryboard(
      [
        { id: "a", title: "A", narration: "", parts: ["side_left"], from: "left", camera: "iso" },
        { id: "b", title: "B", narration: "", parts: ["side_left"], from: "left", camera: "iso" },
      ],
      manifest,
    );
    expect(issues.some((i) => i.level === "warning" && i.message.includes("side_right"))).toBe(true);
    expect(issues.some((i) => i.level === "warning" && i.message.includes("more than once") && i.stepId === "b")).toBe(true);
  });

  test("de-duplicates repeated step ids", () => {
    const { steps } = validateStoryboard(
      [
        { id: "s", title: "A", narration: "", parts: [], from: "left", camera: "iso" },
        { id: "s", title: "B", narration: "", parts: [], from: "left", camera: "iso" },
      ],
      manifest,
    );
    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });
});

import { cleanStoredStoryboard } from "@/lib/storyboard/validate";
describe("cleanStoredStoryboard", () => {
  test("survives non-array jsonb", () => {
    expect(cleanStoredStoryboard({ steps: "oops", parts: { a: 1 } })).toEqual({ steps: [], parts: [] });
    expect(cleanStoredStoryboard(undefined)).toEqual({ steps: [], parts: [] });
  });
  test("drops malformed parts and cleans steps against the remaining ones", () => {
    const r = cleanStoredStoryboard({
      parts: [manifest[0], { id: 5 }, { id: "x", label: "x", size: [1, 1], center: [0, 0, 0] }, null],
      steps: [{ id: "s", title: 42, parts: ["side_left", "x"], from: "sideways", camera: "iso" }, "junk"],
    });
    expect(r.parts).toEqual([manifest[0]]);
    expect(r.steps).toEqual([{ id: "s", title: "Step 1", narration: "", parts: ["side_left"], from: "above", camera: "iso" }]);
  });
});
