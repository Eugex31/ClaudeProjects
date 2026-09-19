import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const socialPostInputSchema = z.object({
  socialAccountId: z.string().min(1, "Choose an account"),
  caption: z.string().max(5000).default(""),
  mediaImageId: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

export const socialPostUpdateSchema = socialPostInputSchema.partial();

export const scheduleSocialPostSchema = z.object({
  scheduledAt: z.coerce.date(),
});
