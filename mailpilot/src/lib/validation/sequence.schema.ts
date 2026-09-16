import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const sequenceCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});

export const sequenceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  triggerType: z.enum(["MANUAL", "TAG_ADDED", "CONTACT_CREATED", "DATE_FIELD"]).optional(),
  triggerTagId: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

export const sequenceStepInputSchema = z.object({
  delaySeconds: z.coerce.number().int().min(0).max(60 * 60 * 24 * 90), // up to 90 days
  subject: z.string().trim().min(1, "Subject is required").max(300),
  // 300000 (was 50000) — same reasoning as template.schema.ts: an
  // HTML-format body can legitimately embed images as data: URIs, and
  // `body` is unrestricted Postgres TEXT, so this is a pure
  // application-level sanity bound, not a storage constraint.
  body: z.string().max(300000),
  bodyFormat: z.enum(["RICH_TEXT", "HTML"]).optional(),
});

export const addEnrollmentsSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(5000),
});
