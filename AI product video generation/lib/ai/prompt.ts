import { z } from "zod";
import { CAMERA_PRESETS, DIRECTIONS, LIMITS, type Language, type PartManifest } from "@/lib/storyboard/types";

export const StoryboardOutputSchema = z.object({
  steps: z.array(z.object({
    title: z.string(),
    narration: z.string(),
    parts: z.array(z.string()),
    from: z.enum(DIRECTIONS),
    camera: z.enum(CAMERA_PRESETS),
    warning: z.string(),
  })),
});

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", pt: "Portuguese", es: "Spanish", fr: "French" };

const SYSTEM = `You turn a product's assembly manual into a storyboard for an animated 3D assembly video.
The video renders the customer's real 3D model, so you must only reference the part ids listed in the part list - never invent parts.
Rules:
- Follow the manual's step order. One storyboard step per manual step; split a manual step only if it installs unrelated groups of parts.
- "parts" lists the part ids that are installed (move into place) during that step. Each part id should be installed in exactly one step.
- Match manual wording (e.g. "dowel", "cam lock", "shelf") to part ids using the ids, labels, sizes and positions given. Positions are the assembled positions in metres; y is up.
- "from" is the direction the parts travel in from (e.g. "above" for parts dropped onto a base, "left" for a left side panel).
- "camera" is the preset angle that best shows the parts being installed; prefer "iso" unless another angle is clearly better.
- "title": at most ${LIMITS.title} characters. "narration": one or two short spoken sentences, at most ${LIMITS.narration} characters, plain words a consumer understands.
- "warning": a short safety note only if the manual gives one for that step (two-person lift, sharp edges, do not overtighten); otherwise "".
- Write title, narration and warning in the requested language.`;

export function buildGenerationPrompt(input: { manualText: string; parts: PartManifest; language: Language }) {
  const partList = input.parts
    .map((p) => `- ${p.id} | label: ${p.label} | size: ${p.size.join(" x ")} | position: ${p.center.join(", ")}`)
    .join("\n");
  const user = `Language for all text: ${LANGUAGE_NAMES[input.language]}

<part_list>
${partList}
</part_list>

<manual>
${input.manualText}
</manual>

Produce the storyboard.`;
  return { system: SYSTEM, user };
}
