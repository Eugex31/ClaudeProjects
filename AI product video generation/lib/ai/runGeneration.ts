import { canGenerate } from "@/lib/quota";
import { validateStoryboard } from "@/lib/storyboard/validate";
import type { Issue, Language, PartManifest, Step } from "@/lib/storyboard/types";
import type { Role } from "@/lib/data/orgs";
import { GenerationError } from "./generate";

export type GenerationContext = {
  role: Role; quota: number; used: number; language: Language;
  parts: PartManifest; manualText: string; aiConfigured: boolean;
};
export type GenerationDeps = {
  generate: (i: { manualText: string; parts: PartManifest; language: Language }) => Promise<unknown[]>;
  saveSteps: (steps: Step[]) => Promise<void>;
  incrementUsage: () => Promise<void>;
};
type Result = { status: 200; steps: Step[]; issues: Issue[] } | { status: number; error: string };

export async function runGeneration(ctx: GenerationContext | null, deps: GenerationDeps): Promise<Result> {
  if (!ctx) return { status: 404, error: "Project not found." };
  if (ctx.role === "viewer") return { status: 403, error: "Viewers cannot generate storyboards." };
  if (!ctx.aiConfigured) return { status: 503, error: "AI generation is not configured; you can build the storyboard manually." };
  if (!canGenerate(ctx.used, ctx.quota)) {
    return { status: 429, error: `Your workspace has used all ${ctx.quota} AI generations this month.` };
  }
  if (!ctx.manualText.trim()) return { status: 400, error: "Add the manual text before generating." };

  let raw: unknown[];
  try {
    raw = await deps.generate({ manualText: ctx.manualText, parts: ctx.parts, language: ctx.language });
  } catch (err) {
    if (err instanceof GenerationError) return { status: err.status, error: err.message };
    console.error("generation failed", err);
    return { status: 502, error: "The AI service failed. Please try again." };
  }
  const { steps, issues } = validateStoryboard(raw, ctx.parts);
  if (steps.length === 0) {
    return { status: 502, error: "The AI returned no steps. Try again or build the storyboard manually." };
  }
  try {
    await deps.saveSteps(steps);
  } catch (err) {
    console.error("saving storyboard failed", err);
    return { status: 500, error: "Could not save the storyboard." };
  }
  await deps.incrementUsage();
  return { status: 200, steps, issues };
}
