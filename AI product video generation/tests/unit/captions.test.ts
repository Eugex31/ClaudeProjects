import { expect, test } from "vitest";
import { captionFor } from "@/lib/player/captions";
import { buildTimeline } from "@/lib/player/timeline";

const tl = buildTimeline(
  [{ id: "s", title: "Attach sides", narration: "Stand them up.", parts: [], from: "left", camera: "iso", warning: "Two people" }],
  [],
);
test("caption has counter, title, narration and warning", () => {
  expect(captionFor(tl, 0)).toEqual({ counter: "Step 1 / 1", title: "Attach sides", narration: "Stand them up.", warning: "Two people" });
});
test("no caption outside the timeline", () => expect(captionFor(tl, -1)).toBeNull());
