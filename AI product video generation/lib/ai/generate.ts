import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildGenerationPrompt, StoryboardOutputSchema } from "./prompt";
import type { Language, PartManifest } from "@/lib/storyboard/types";

export class GenerationError extends Error {
  constructor(message: string, public status: 422 | 502) {
    super(message);
  }
}

export async function generateSteps(
  input: { manualText: string; parts: PartManifest; language: Language },
  client: Anthropic = new Anthropic(),
): Promise<unknown[]> {
  const { system, user } = buildGenerationPrompt(input);
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(StoryboardOutputSchema) },
  });
  if (response.stop_reason === "refusal") {
    throw new GenerationError("The AI declined to process this manual. Edit the manual text or build the storyboard manually.", 422);
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new GenerationError("The AI response was incomplete. Try again, or shorten the manual.", 502);
  }
  return response.parsed_output.steps;
}
