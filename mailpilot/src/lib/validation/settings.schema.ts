import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const settingsUpdateSchema = z
  .object({
    businessName: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
    dailySendLimit: z.coerce.number().int().min(1).max(5000),
    delayMinSeconds: z.coerce.number().int().min(5).max(3600),
    delayMaxSeconds: z.coerce.number().int().min(5).max(3600),
    senderName: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
    replyTo: z.preprocess(emptyToNull, z.string().trim().email("Invalid reply-to address").nullable()),
    signatureHtml: z.preprocess(emptyToNull, z.string().max(5000).nullable()),
    unsubscribeFooterText: z.preprocess(emptyToNull, z.string().max(1000).nullable()),
  })
  .refine((data) => data.delayMaxSeconds >= data.delayMinSeconds, {
    message: "Max delay must be greater than or equal to min delay",
    path: ["delayMaxSeconds"],
  });
