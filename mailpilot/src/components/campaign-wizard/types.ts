export type Service = "campaign" | "sequence" | "newsletter" | "social" | "template";

export type CommonAnswers = { durationDays: number; startAt: string; tagId: string | null };
export type CampaignAnswers = { cta: string; offer: string; tone: "Professional" | "Friendly" | "Urgent" | "Playful" };
export type SequenceAnswers = { goal: string; cadenceDays: number };
export type NewsletterAnswers = { frequency: "WEEKLY" | "MONTHLY"; coverage: string };
export type SocialAnswers = {
  socialAccountIds: string[];
  postsPerWeek: number;
  tone: "Professional" | "Casual" | "Promotional" | "Behind-the-scenes";
};
export type TemplateAnswers = { purpose: string; tone: "Professional" | "Friendly" | "Urgent" | "Playful" };

export type Tag = { id: string; name: string };
export type ConnectedAccount = { id: string; platform: "FACEBOOK_PAGE" | "INSTAGRAM_BUSINESS"; displayName: string };

export type GeneratedResult = {
  campaign?: { subject: string; bodyHtml: string };
  sequence?: { name: string; stepCount: number; cadenceDays: number; steps: { subject: string; bodyHtml: string }[] };
  newsletterTemplate?: { subject: string; bodyHtml: string; frequency: "WEEKLY" | "MONTHLY" };
  socialPosts?: { caption: string }[];
  template?: { subject: string; bodyHtml: string };
};

export type ReviewSequenceStep = { subject: string; bodyHtml: string; delaySeconds: number };
export type ReviewSocialPost = {
  accountId: string;
  accountLabel: string;
  caption: string;
  mediaImageId: string | null;
  mediaUrl: string | null;
};

export type ReviewState = {
  campaign?: { subject: string; bodyHtml: string; activateNow: boolean };
  sequence?: { name: string; steps: ReviewSequenceStep[]; activateNow: boolean };
  newsletter?: { subject: string; bodyHtml: string; frequency: "WEEKLY" | "MONTHLY" };
  socialPosts?: ReviewSocialPost[];
  template?: { name: string; subject: string; bodyHtml: string };
};
