import { NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { campaignWizardGenerateSchema } from "@/lib/validation/campaignWizard.schema";
import { checkAiUsageLimit } from "@/lib/billing";
import {
  generateEmailContent,
  generateSequencePlan,
  generateSocialCampaignPosts,
  NoAiConnectionError,
} from "@/lib/ai/generate";
import { incrementTodayAiUsage } from "@/lib/aiUsage";

const MAX_SEQUENCE_STEPS = 12;
const MAX_SOCIAL_POSTS = 30;

export const POST = withAuth(async (req, { userId }) => {
  const input = campaignWizardGenerateSchema.parse(await req.json());

  // One generation call per selected service — check upfront that the
  // whole batch fits within the remaining allowance rather than generating
  // some services and failing partway through the rest.
  const usageCheck = await checkAiUsageLimit(userId, input.services.length);
  if (!usageCheck.allowed) {
    return NextResponse.json({ error: usageCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const durationLabel = `a ${input.common.durationDays}-day campaign starting ${input.common.startAt.toDateString()}`;
  const result: {
    campaign?: { subject: string; bodyHtml: string };
    sequence?: { name: string; stepCount: number; cadenceDays: number; steps: { subject: string; bodyHtml: string }[] };
    newsletterTemplate?: { subject: string; bodyHtml: string; frequency: "WEEKLY" | "MONTHLY" };
    socialPosts?: { caption: string }[];
    template?: { subject: string; bodyHtml: string };
  } = {};

  try {
    if (input.services.includes("campaign") && input.campaign) {
      const prompt = [
        `Campaign intent: ${input.intent}`,
        `This piece: a one-off marketing email campaign, part of ${durationLabel}.`,
        `Primary call-to-action: ${input.campaign.cta}`,
        `Offer/deadline: ${input.campaign.offer || "none specified"}`,
        `Tone: ${input.campaign.tone}`,
      ].join("\n");
      result.campaign = await generateEmailContent(userId, { prompt, kind: "campaign", connectionId: input.connectionId });
      await incrementTodayAiUsage(userId);
    }

    if (input.services.includes("sequence") && input.sequence) {
      const stepCount = Math.min(
        MAX_SEQUENCE_STEPS,
        Math.max(1, Math.round(input.common.durationDays / input.sequence.cadenceDays))
      );
      const prompt = [
        `Campaign intent: ${input.intent}`,
        `This piece: an automated email sequence running over ${input.common.durationDays} days, sending roughly every ${input.sequence.cadenceDays} day(s).`,
        `Goal: ${input.sequence.goal}`,
      ].join("\n");
      const plan = await generateSequencePlan(userId, { prompt, stepCount, connectionId: input.connectionId });
      await incrementTodayAiUsage(userId);
      result.sequence = { ...plan, stepCount: plan.steps.length, cadenceDays: input.sequence.cadenceDays };
    }

    if (input.services.includes("newsletter") && input.newsletter) {
      const prompt = [
        `Campaign intent: ${input.intent}`,
        `This piece: a recurring ${input.newsletter.frequency === "WEEKLY" ? "weekly" : "monthly"} newsletter edition template.`,
        `Typical coverage: ${input.newsletter.coverage || "general updates related to the campaign"}`,
      ].join("\n");
      const content = await generateEmailContent(userId, { prompt, kind: "newsletter", connectionId: input.connectionId });
      await incrementTodayAiUsage(userId);
      result.newsletterTemplate = { ...content, frequency: input.newsletter.frequency };
    }

    if (input.services.includes("social") && input.social) {
      const postCount = Math.min(
        MAX_SOCIAL_POSTS,
        Math.max(1, Math.round((input.social.postsPerWeek * input.common.durationDays) / 7))
      );
      const prompt = [
        `Campaign intent: ${input.intent}`,
        `This piece: a batch of social media posts running over ${input.common.durationDays} days at ${input.social.postsPerWeek} posts/week.`,
        `Tone: ${input.social.tone}`,
      ].join("\n");
      const plan = await generateSocialCampaignPosts(userId, { prompt, postCount, connectionId: input.connectionId });
      await incrementTodayAiUsage(userId);
      result.socialPosts = plan.posts;
    }

    if (input.services.includes("template") && input.template) {
      const prompt = [
        `Campaign intent: ${input.intent}`,
        `This piece: a reusable email template for future use, not tied to this campaign's schedule.`,
        `Purpose: ${input.template.purpose}`,
        `Tone: ${input.template.tone}`,
      ].join("\n");
      result.template = await generateEmailContent(userId, { prompt, kind: "template", connectionId: input.connectionId });
      await incrementTodayAiUsage(userId);
    }
  } catch (err) {
    if (err instanceof NoAiConnectionError) {
      return NextResponse.json({ error: err.message, noConnection: true }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json(result);
});
