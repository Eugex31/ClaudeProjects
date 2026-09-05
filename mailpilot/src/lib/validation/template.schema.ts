import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  subject: z.string().trim().max(300).default(""),
  // 300000 (was 50000) — an HTML-format body can legitimately embed images
  // as data: URIs (composeEmail.ts's sanitizer explicitly allows the data:
  // scheme on <img>), which is real body content, not abuse: a handful of
  // modest, already-compressed photos alone runs to tens of thousands of
  // characters. `body` is stored as unrestricted Postgres TEXT, so this is
  // a pure application-level sanity bound, not a storage constraint.
  body: z.string().max(300000).default(""),
  bodyFormat: z.enum(["RICH_TEXT", "HTML"]).optional(),
  // Raw MJML source from the visual editor — only ever sent by its own save
  // path (src/app/(editor)/templates/[id]/editor). MJML markup is more
  // verbose than its compiled HTML, hence the larger cap than `body`.
  editorSource: z.preprocess(emptyToNull, z.string().max(200000).nullable().optional()),
  categoryId: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

export const templateUpdateSchema = templateInputSchema.partial();

export const saveAsTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});

export const templateListQuerySchema = z.object({
  categoryId: z.string().optional(),
  search: z.string().optional(),
  starred: z.coerce.boolean().optional(),
});
