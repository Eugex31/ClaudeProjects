import { z } from "zod";

/**
 * Fields for creating a screen. `name` is required; `locationId` names the site
 * the screen belongs to and is accepted as a free string here. The action
 * verifies it resolves to a location in the caller's own organization before
 * the write, because referential-integrity checks are exempt from row-level
 * security.
 */
export const screenSchema = z.object({
  name: z.string().trim().min(1, "Enter a screen name."),
  locationId: z.string().trim().min(1, "Choose a location for this screen."),
});

export type ScreenInput = z.infer<typeof screenSchema>;
