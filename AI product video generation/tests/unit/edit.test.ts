import { expect, test } from "vitest";
import { addStep, moveStep, removeStep, togglePart } from "@/lib/storyboard/edit";
import type { Step } from "@/lib/storyboard/types";

const s = (id: string, parts: string[] = []): Step => ({ id, title: id, narration: "", parts, from: "above", camera: "iso" });

test("moveStep reorders without mutating", () => {
  const steps = [s("a"), s("b"), s("c")];
  expect(moveStep(steps, 0, 2).map((x) => x.id)).toEqual(["b", "c", "a"]);
  expect(steps.map((x) => x.id)).toEqual(["a", "b", "c"]);
});
test("togglePart adds and removes", () => {
  const once = togglePart([s("a")], 0, "p1");
  expect(once[0].parts).toEqual(["p1"]);
  expect(togglePart(once, 0, "p1")[0].parts).toEqual([]);
});
test("togglePart moves a part out of any other step", () => {
  const steps = togglePart([s("a", ["p1"]), s("b")], 1, "p1");
  expect(steps[0].parts).toEqual([]);
  expect(steps[1].parts).toEqual(["p1"]);
});
test("addStep inserts after index with a unique id", () => {
  const steps = addStep([s("step_1"), s("step_2")], 0);
  expect(steps).toHaveLength(3);
  expect(steps[1].title).toBe("New step");
  expect(new Set(steps.map((x) => x.id)).size).toBe(3);
});
test("removeStep", () => expect(removeStep([s("a"), s("b")], 0).map((x) => x.id)).toEqual(["b"]));
