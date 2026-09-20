import { z } from "zod";

export const aiConnectionInputSchema = z.object({
  provider: z.enum(["OPENAI", "ANTHROPIC"]),
  label: z.string().trim().min(1, "Label is required").max(100),
  apiKey: z.string().trim().min(1, "API key is required").max(500),
});

export const generateEmailInputSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required").max(4000),
  kind: z.enum(["campaign", "template", "sequence-step", "newsletter"]),
  existingSubject: z.string().max(300).optional(),
  existingBody: z.string().max(20000).optional(),
  connectionId: z.string().optional(),
});

export const generateImageInputSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required").max(2000),
  connectionId: z.string().optional(),
});

export const generateCaptionInputSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required").max(2000),
  connectionId: z.string().optional(),
});
