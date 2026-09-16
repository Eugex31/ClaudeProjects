import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const baseFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  templateId: z.string().min(1, "Template is required"),
  targetTagId: z.preprocess(emptyToNull, z.string().nullable().optional()),
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
  dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(),
  hourUtc: z.coerce.number().int().min(0).max(23),
  minuteUtc: z.coerce.number().int().min(0).max(59),
};

export const newsletterCreateSchema = z.object(baseFields).refine(
  (data) =>
    data.frequency === "WEEKLY" ? data.dayOfWeek != null : data.dayOfMonth != null,
  { message: "Pick a day matching the selected frequency", path: ["dayOfWeek"] }
);

export const newsletterUpdateSchema = z.object(baseFields).partial();
