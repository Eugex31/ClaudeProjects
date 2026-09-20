import { z } from "zod";

export const profileInputSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(80),
});
