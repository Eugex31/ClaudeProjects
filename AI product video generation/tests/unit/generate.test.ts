import { expect, test, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { GenerationError, generateSteps } from "@/lib/ai/generate";

const input = { manualText: "m", parts: [], language: "en" as const };
const fake = (response: object) =>
  ({ messages: { parse: vi.fn().mockResolvedValue(response) } }) as unknown as Anthropic;

test("returns parsed steps", async () => {
  const steps = [{ title: "T", narration: "", parts: [], from: "above", camera: "iso", warning: "" }];
  await expect(generateSteps(input, fake({ stop_reason: "end_turn", parsed_output: { steps } }))).resolves.toEqual(steps);
});
test("refusal becomes a 422 GenerationError", async () => {
  const err = await generateSteps(input, fake({ stop_reason: "refusal", parsed_output: null })).catch((e) => e);
  expect(err).toBeInstanceOf(GenerationError);
  expect(err.status).toBe(422);
});
test("truncated output becomes a 502", async () => {
  const err = await generateSteps(input, fake({ stop_reason: "max_tokens", parsed_output: null })).catch((e) => e);
  expect(err.status).toBe(502);
});
