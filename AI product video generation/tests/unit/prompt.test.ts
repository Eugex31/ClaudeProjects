import { expect, test } from "vitest";
import { buildGenerationPrompt, StoryboardOutputSchema } from "@/lib/ai/prompt";

const parts = [{ id: "side_left", label: "side left", size: [0.02, 1, 0.3] as [number, number, number], center: [-0.4, 0.5, 0] as [number, number, number] }];

test("user prompt contains part ids, manual and target language", () => {
  const { system, user } = buildGenerationPrompt({ manualText: "Step 1: attach the left side.", parts, language: "pt" });
  expect(user).toContain("side_left");
  expect(user).toContain("Step 1: attach the left side.");
  expect(system + user).toContain("Portuguese");
  expect(system).toMatch(/only.*part ids/i);
});

test("schema accepts a well-formed result and rejects a bad direction", () => {
  const ok = { steps: [{ title: "T", narration: "N", parts: ["side_left"], from: "left", camera: "iso", warning: "" }] };
  expect(StoryboardOutputSchema.safeParse(ok).success).toBe(true);
  expect(StoryboardOutputSchema.safeParse({ steps: [{ ...ok.steps[0], from: "up" }] }).success).toBe(false);
});
