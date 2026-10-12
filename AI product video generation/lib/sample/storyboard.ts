import type { Step } from "@/lib/storyboard/types";

export const SAMPLE_PROJECT_NAME = "Sample: 3-shelf bookshelf";

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`);

export const SAMPLE_STEPS: Step[] = [
  { id: "step_1", title: "Lay out the bottom panel and dowels", narration: "Place the bottom panel on a soft surface and push the eight wooden dowels into the pre-drilled holes.", parts: ["bottom", ...range("dowel", 8)], from: "above", camera: "iso" },
  { id: "step_2", title: "Attach the left side", narration: "Slide the left side panel onto the dowels until it sits flush with the bottom panel.", parts: ["side_left"], from: "left", camera: "front" },
  { id: "step_3", title: "Attach the right side", narration: "Repeat on the right: line up the holes and press the right side panel onto the dowels.", parts: ["side_right"], from: "right", camera: "front" },
  { id: "step_4", title: "Add the top panel", narration: "Lower the top panel onto the upper dowels so both sides are held in place.", parts: ["top"], from: "above", camera: "iso", warning: "Two people recommended to keep the frame steady." },
  { id: "step_5", title: "Lock the joints", narration: "Insert the eight cam locks and turn each one clockwise about half a turn until the joint is tight.", parts: range("cam_lock", 8), from: "front", camera: "iso", warning: "Do not overtighten the cam locks." },
  { id: "step_6", title: "Place the shelves", narration: "Rest the three shelves on the shelf pins, starting with the lowest one.", parts: range("shelf", 3), from: "front", camera: "front" },
  { id: "step_7", title: "Fix the back panel", narration: "Lay the back panel on the rear of the frame and nail it along the edges.", parts: ["back_panel"], from: "back", camera: "back", warning: "Anchor the bookshelf to the wall to prevent tipping." },
];

export const SAMPLE_MANUAL = SAMPLE_STEPS
  .map((s, i) => `Step ${i + 1}: ${s.title}.\n${s.narration}${s.warning ? `\nWARNING: ${s.warning}` : ""}`)
  .join("\n\n");
