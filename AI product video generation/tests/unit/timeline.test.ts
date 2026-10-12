import { describe, expect, test } from "vitest";
import { buildTimeline, easeOutCubic, locate, stepDuration } from "@/lib/player/timeline";
import type { PartManifest, Step } from "@/lib/storyboard/types";

const manifest: PartManifest = [
  { id: "a", label: "A", size: [2, 1, 1], center: [0, 0, 0] },
  { id: "b", label: "B", size: [1, 1, 1], center: [1, 0, 0] },
];
const step = (id: string, parts: string[], narration = "", from: Step["from"] = "above"): Step =>
  ({ id, title: id, narration, parts, from, camera: "iso" });

describe("stepDuration", () => {
  test("minimum 4 seconds", () => expect(stepDuration("")).toBe(4));
  test("scales with words", () => expect(stepDuration(Array(25).fill("w").join(" "))).toBeCloseTo(11.5));
});

describe("buildTimeline", () => {
  test("accumulates start times and visible parts", () => {
    const tl = buildTimeline([step("s1", ["a"]), step("s2", ["b"])], manifest);
    expect(tl.steps[0].start).toBe(0);
    expect(tl.steps[1].start).toBe(4);
    expect(tl.total).toBe(8);
    expect(tl.steps[0].visibleBefore).toEqual([]);
    expect(tl.steps[1].visibleBefore).toEqual(["a"]);
  });

  test("offset is direction * 1.5 * largest dimension", () => {
    const tl = buildTimeline([step("s1", ["a"], "", "left")], manifest);
    expect(tl.extent).toBe(2);
    expect(tl.steps[0].animating[0]).toEqual({ partId: "a", offset: [-3, 0, 0] });
  });

  test("empty storyboard", () => {
    const tl = buildTimeline([], manifest);
    expect(tl.total).toBe(0);
    expect(locate(tl, 0)).toEqual({ index: -1, local: 0 });
  });
});

describe("locate", () => {
  const tl = buildTimeline([step("s1", ["a"]), step("s2", ["b"])], manifest);
  test("inside first step", () => expect(locate(tl, 1)).toEqual({ index: 0, local: 1 }));
  test("inside second step", () => expect(locate(tl, 5)).toEqual({ index: 1, local: 1 }));
  test("clamps past end to last step end", () => expect(locate(tl, 99)).toEqual({ index: 1, local: 4 }));
  test("clamps negative to start", () => expect(locate(tl, -1)).toEqual({ index: 0, local: 0 }));
});

test("easeOutCubic endpoints", () => {
  expect(easeOutCubic(0)).toBe(0);
  expect(easeOutCubic(1)).toBe(1);
  expect(easeOutCubic(2)).toBe(1);
});
