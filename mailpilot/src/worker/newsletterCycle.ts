import { prisma } from "@/lib/prisma";
import { computeSchedule } from "@/lib/scheduling";
import { checkTierLimit } from "@/lib/billing";

type NewsletterForCycle = {
  id: string;
  userId: string;
  name: string;
  templateId: string;
  targetTagId: string | null;
};

// The actual per-cycle work, factored out so both the worker's scheduled
// poll and the manual "Send now" API route can call it. Builds one ordinary
// Campaign + CampaignRecipient rows directly in SENDING state — from here
// it's indistinguishable from a manually-started campaign, so the existing
// sending engine, daily limits, and tier accounting all apply with no
// newsletter-specific code anywhere else.
export async function spawnNewsletterCampaign(newsletter: NewsletterForCycle): Promise<{ campaignId: string } | null> {
  const template = await prisma.template.findUnique({ where: { id: newsletter.templateId } });
  if (!template) {
    console.warn(`[newsletters] Newsletter ${newsletter.id} references a missing template — skipping cycle`);
    return null;
  }

  const recipients = await prisma.contact.findMany({
    where: {
      userId: newsletter.userId,
      ...(newsletter.targetTagId ? { tags: { some: { tagId: newsletter.targetTagId } } } : {}),
    },
    select: { id: true },
  });
  if (recipients.length === 0) {
    console.warn(`[newsletters] Newsletter ${newsletter.id} has no matching contacts this cycle — skipping`);
    return null;
  }

  const limitCheck = await checkTierLimit(newsletter.userId, "emails", recipients.length);
  if (!limitCheck.allowed) {
    console.warn(`[newsletters] Newsletter ${newsletter.id} skipped: ${limitCheck.message}`);
    return null;
  }

  const dateLabel = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const campaign = await prisma.campaign.create({
    data: {
      userId: newsletter.userId,
      name: `${newsletter.name} — ${dateLabel}`,
      subject: template.subject,
      body: template.body,
      bodyFormat: template.bodyFormat,
      status: "SENDING",
      startedAt: new Date(),
    },
  });

  const schedule = computeSchedule(recipients.length, campaign.delayMinSeconds, campaign.delayMaxSeconds);
  await prisma.campaignRecipient.createMany({
    data: recipients.map((r, i) => ({
      campaignId: campaign.id,
      contactId: r.id,
      scheduledAt: schedule[i],
    })),
  });

  return { campaignId: campaign.id };
}
