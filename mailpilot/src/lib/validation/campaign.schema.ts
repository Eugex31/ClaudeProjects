import { z } from "zod";

// An empty override field means "clear this override back to the account
// default", which must write null, not be silently skipped (Prisma treats
// `undefined` in an update payload as "don't touch this field", so undefined
// would leave a previously-set override stuck).
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});

export const campaignUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().max(300).optional(),
  // 300000 (was 50000) — same reasoning as template.schema.ts: an
  // HTML-format body can legitimately embed images as data: URIs, and
  // `body` is unrestricted Postgres TEXT, so this is a pure
  // application-level sanity bound, not a storage constraint.
  body: z.string().max(300000).optional(),
  bodyFormat: z.enum(["RICH_TEXT", "HTML"]).optional(),
  delayMinSeconds: z.coerce.number().int().min(5).max(3600).optional(),
  delayMaxSeconds: z.coerce.number().int().min(5).max(3600).optional(),
  dailySendLimitOverride: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(1).max(5000).nullable().optional()
  ),
  senderNameOverride: z.preprocess(emptyToNull, z.string().trim().max(200).nullable().optional()),
  replyToOverride: z.preprocess(
    emptyToNull,
    z.string().trim().email("Invalid reply-to address").nullable().optional()
  ),
  unsubscribeFooterEnabled: z.boolean().optional(),
});

export const addRecipientsSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(5000),
});

export const testSendSchema = z.object({
  to: z.string().trim().email("Invalid email address"),
  sampleContactId: z.string().optional(),
});
