import { z } from "zod";

const commonAnswersSchema = z.object({
  durationDays: z.coerce.number().int().min(1).max(365),
  startAt: z.coerce.date(),
  tagId: z.string().nullable(), // null = all contacts
});

const campaignAnswersSchema = z.object({
  cta: z.string().trim().max(300),
  offer: z.string().trim().max(300).optional(),
  tone: z.enum(["Professional", "Friendly", "Urgent", "Playful"]),
});

const sequenceAnswersSchema = z.object({
  goal: z.string().trim().min(1).max(300),
  cadenceDays: z.coerce.number().int().min(1).max(30),
});

const newsletterAnswersSchema = z.object({
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
  coverage: z.string().trim().max(300).optional(),
});

const socialAnswersSchema = z.object({
  socialAccountIds: z.array(z.string().min(1)).min(1).max(20),
  postsPerWeek: z.coerce.number().int().min(1).max(7),
  tone: z.enum(["Professional", "Casual", "Promotional", "Behind-the-scenes"]),
});

const templateAnswersSchema = z.object({
  purpose: z.string().trim().min(1).max(300),
  tone: z.enum(["Professional", "Friendly", "Urgent", "Playful"]),
});

export const campaignWizardGenerateSchema = z.object({
  intent: z.string().trim().min(1, "Describe your campaign first").max(2000),
  services: z.array(z.enum(["campaign", "sequence", "newsletter", "social", "template"])).min(1).max(5),
  common: commonAnswersSchema,
  campaign: campaignAnswersSchema.optional(),
  sequence: sequenceAnswersSchema.optional(),
  newsletter: newsletterAnswersSchema.optional(),
  social: socialAnswersSchema.optional(),
  template: templateAnswersSchema.optional(),
  connectionId: z.string().optional(),
});

export type CampaignWizardGenerateInput = z.infer<typeof campaignWizardGenerateSchema>;
