import { z } from "zod";

export const tagInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});
