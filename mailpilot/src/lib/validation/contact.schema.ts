import { z } from "zod";

const normalizeEmail = (v: string) => v.trim().toLowerCase();
// Empty string means "clear this field" and must write null, not be silently
// skipped — Prisma treats `undefined` in an update payload as "don't touch
// this field", which would leave a previously-set value stuck on edit.
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const contactInputSchema = z.object({
  firstName: z.preprocess(emptyToNull, z.string().max(120).nullable().optional()),
  lastName: z.preprocess(emptyToNull, z.string().max(120).nullable().optional()),
  email: z.string().trim().min(1, "Email is required").email("Invalid email address").transform(normalizeEmail),
  company: z.preprocess(emptyToNull, z.string().max(200).nullable().optional()),
  jobTitle: z.preprocess(emptyToNull, z.string().max(200).nullable().optional()),
  website: z.preprocess(emptyToNull, z.string().max(300).nullable().optional()),
  greet: z.preprocess(emptyToNull, z.string().max(300).nullable().optional()),
  appointmentAt: z.preprocess(emptyToNull, z.coerce.date().nullable().optional()),
  customFields: z.record(z.string(), z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactUpdateSchema = contactInputSchema.partial().extend({
  email: contactInputSchema.shape.email.optional(),
});

export const contactListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tagId: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const contactImportRequestSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "No rows to import")
    .max(20000, "Too many rows in a single import"),
});
