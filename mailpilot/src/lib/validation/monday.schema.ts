import { z } from "zod";

export const mondayMappingSchema = z.object({
  boardId: z.string().min(1),
  boardName: z.string().min(1),
  columnMapping: z
    .record(z.string(), z.string().min(1))
    .refine((m) => Boolean(m.email), { message: "The email field must be mapped to a column" }),
});
