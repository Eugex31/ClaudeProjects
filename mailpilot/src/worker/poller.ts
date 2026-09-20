import { prisma } from "@/lib/prisma";
import { getTodaySentCount } from "@/lib/dailyLimit";
import { getEffectiveSettings } from "@/lib/settings";
import { sendRecipient } from "@/worker/sendJob";
import { sendEnrollmentStep } from "@/worker/sendSequenceStep";
import { spawnNewsletterCampaign } from "@/worker/newsletterCycle";
import { computeNextRunAt } from "@/lib/newsletterSchedule";
import { syncContactToMonday } from "@/worker/mondaySyncJob";
import { publishSocialPost } from "@/worker/publishSocialPost";

type DueUser = { userId: string };
type ClaimedRecipient = { id: string; campaignId: string; contactId: string };
type ClaimedEnrollment = { id: string; sequenceId: string; contactId: string };
type ClaimedNewsletter = { id: string };
type ClaimedMondayContact = { id: string; userId: string };

async function findUsersWithDueCampaignWork(): Promise<string[]> {
  const rows = await prisma.$queryRaw<DueUser[]>`
    SELECT DISTINCT c."userId" as "userId"
    FROM "Campaign" c
    JOIN "CampaignRecipient" r ON r."campaignId" = c.id
    JOIN "User" u ON u.id = c."userId"
    WHERE c.status = 'SENDING'
      AND r.status IN ('PENDING', 'RETRYING')
      AND r."scheduledAt" <= now()
      AND u.status = 'ACTIVE'
  `;
  return rows.map((r) => r.userId);
}

// u.status = 'ACTIVE' is checked here too, not just in the "which users have
// due work" query above — a customer could be suspended in the narrow window
// between that query and this claim, and an in-flight suspension should never
// let one more recipient slip through.
async function claimNextRecipient(userId: string): Promise<ClaimedRecipient | null> {
  const rows = await prisma.$queryRaw<ClaimedRecipient[]>`
    WITH due AS (
      SELECT r.id
      FROM "CampaignRecipient" r
      JOIN "Campaign" c ON c.id = r."campaignId"
      JOIN "User" u ON u.id = c."userId"
      WHERE c."userId" = ${userId}
        AND c.status = 'SENDING'
        AND r.status IN ('PENDING', 'RETRYING')
        AND r."scheduledAt" <= now()
        AND u.status = 'ACTIVE'
      ORDER BY r."scheduledAt" ASC
      LIMIT 1
      FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE "CampaignRecipient"
    SET status = 'SENDING', "lockedAt" = now()
    WHERE id IN (SELECT id FROM due)
    RETURNING id, "campaignId" as "campaignId", "contactId" as "contactId"
  `;
  return rows[0] ?? null;
}

const STALE_LOCK_MINUTES = 2;

// If the worker crashes (or is killed) after claiming a row but before it
// finishes sending, that row is stuck in SENDING forever unless something
// reclaims it — nothing else ever queries for SENDING rows again. Reset any
// row that's been "in flight" longer than a real Gmail API call could
// plausibly take back to PENDING so it gets retried on a future poll.
async function reapStaleCampaignLocks(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "CampaignRecipient"
    SET status = 'PENDING', "lockedAt" = NULL
    WHERE status = 'SENDING'
      AND "lockedAt" < now() - (${STALE_LOCK_MINUTES}::text || ' minutes')::interval
  `;
}

async function markCampaignsCompleteIfDone(userId: string): Promise<void> {
  const sendingCampaigns = await prisma.campaign.findMany({
    where: { userId, status: "SENDING" },
    select: { id: true },
  });
  for (const { id } of sendingCampaigns) {
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId: id, status: { in: ["PENDING", "RETRYING", "SENDING"] } },
    });
    if (remaining === 0) {
      await prisma.campaign.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
    }
  }
}

async function pollCampaignsOnce(): Promise<void> {
  await reapStaleCampaignLocks();

  const userIds = await findUsersWithDueCampaignWork();

  for (const userId of userIds) {
    const settings = await getEffectiveSettings(userId);
    const campaign = await prisma.campaign.findFirst({
      where: { userId, status: "SENDING" },
      select: { dailySendLimitOverride: true },
    });
    const dailyLimit = campaign?.dailySendLimitOverride ?? settings.dailySendLimit;
    const sentToday = await getTodaySentCount(userId);
    if (sentToday >= dailyLimit) {
      continue;
    }

    const claimed = await claimNextRecipient(userId);
    if (!claimed) continue;

    await sendRecipient(claimed);
    await markCampaignsCompleteIfDone(userId);
  }
}

// --- Sequences: same FOR UPDATE SKIP LOCKED / stale-lock-reap pattern as
// campaigns above, just against SequenceEnrollment/Sequence instead of
// CampaignRecipient/Campaign. A paused sequence stops sending, same mental
// model as a paused campaign.

// lockedAt IS NULL is the "not currently in flight" check — SequenceEnrollment
// has no SENDING-style status of its own (it stays ACTIVE throughout), so
// lockedAt is the only persistent marker keeping a concurrent poll from
// re-claiming a row a worker is still processing (the FOR UPDATE SKIP LOCKED
// row lock below only covers the claiming UPDATE itself, not the Gmail API
// call afterward).
async function findUsersWithDueSequenceWork(): Promise<string[]> {
  const rows = await prisma.$queryRaw<DueUser[]>`
    SELECT DISTINCT s."userId" as "userId"
    FROM "Sequence" s
    JOIN "SequenceEnrollment" e ON e."sequenceId" = s.id
    JOIN "User" u ON u.id = s."userId"
    WHERE s.status = 'ACTIVE'
      AND e.status = 'ACTIVE'
      AND e."nextSendAt" <= now()
      AND e."lockedAt" IS NULL
      AND u.status = 'ACTIVE'
  `;
  return rows.map((r) => r.userId);
}

// Same defense-in-depth reasoning as claimNextRecipient above.
async function claimNextEnrollment(userId: string): Promise<ClaimedEnrollment | null> {
  const rows = await prisma.$queryRaw<ClaimedEnrollment[]>`
    WITH due AS (
      SELECT e.id
      FROM "SequenceEnrollment" e
      JOIN "Sequence" s ON s.id = e."sequenceId"
      JOIN "User" u ON u.id = s."userId"
      WHERE s."userId" = ${userId}
        AND s.status = 'ACTIVE'
        AND e.status = 'ACTIVE'
        AND e."nextSendAt" <= now()
        AND e."lockedAt" IS NULL
        AND u.status = 'ACTIVE'
      ORDER BY e."nextSendAt" ASC
      LIMIT 1
      FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE "SequenceEnrollment"
    SET "lockedAt" = now()
    WHERE id IN (SELECT id FROM due)
    RETURNING id, "sequenceId" as "sequenceId", "contactId" as "contactId"
  `;
  return rows[0] ?? null;
}

async function reapStaleSequenceLocks(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "SequenceEnrollment"
    SET "lockedAt" = NULL
    WHERE status = 'ACTIVE'
      AND "lockedAt" IS NOT NULL
      AND "lockedAt" < now() - (${STALE_LOCK_MINUTES}::text || ' minutes')::interval
  `;
}

async function pollSequencesOnce(): Promise<void> {
  await reapStaleSequenceLocks();

  const userIds = await findUsersWithDueSequenceWork();

  for (const userId of userIds) {
    const settings = await getEffectiveSettings(userId);
    const sentToday = await getTodaySentCount(userId);
    if (sentToday >= settings.dailySendLimit) {
      continue;
    }

    const claimed = await claimNextEnrollment(userId);
    if (!claimed) continue;

    await sendEnrollmentStep(claimed);
  }
}

// --- Newsletters: same claim/reap pattern as above, at a much lower rate
// (weekly/monthly, not per-recipient) — no per-user distribution needed since
// there's no starvation risk at this volume, just claim-and-process-one in a
// loop until none are due.

async function claimNextNewsletter(): Promise<ClaimedNewsletter | null> {
  const rows = await prisma.$queryRaw<ClaimedNewsletter[]>`
    WITH due AS (
      SELECT n.id
      FROM "Newsletter" n
      JOIN "User" u ON u.id = n."userId"
      WHERE n.status = 'ACTIVE'
        AND n."nextRunAt" <= now()
        AND n."lockedAt" IS NULL
        AND u.status = 'ACTIVE'
      ORDER BY n."nextRunAt" ASC
      LIMIT 1
      FOR UPDATE OF n SKIP LOCKED
    )
    UPDATE "Newsletter"
    SET "lockedAt" = now()
    WHERE id IN (SELECT id FROM due)
    RETURNING id
  `;
  return rows[0] ?? null;
}

async function reapStaleNewsletterLocks(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Newsletter"
    SET "lockedAt" = NULL
    WHERE status = 'ACTIVE'
      AND "lockedAt" IS NOT NULL
      AND "lockedAt" < now() - (${STALE_LOCK_MINUTES}::text || ' minutes')::interval
  `;
}

async function runNewsletterCycle(newsletterId: string): Promise<void> {
  const newsletter = await prisma.newsletter.findUniqueOrThrow({ where: { id: newsletterId } });

  const result = await spawnNewsletterCampaign(newsletter);

  // Advance nextRunAt regardless of whether this cycle actually sent
  // anything — a skipped cycle (no matching contacts, over tier limit) must
  // still wait for its next scheduled slot, not retry every poll tick.
  const nextRunAt = computeNextRunAt(newsletter, newsletter.nextRunAt ?? new Date());
  await prisma.newsletter.update({
    where: { id: newsletter.id },
    data: { nextRunAt, lockedAt: null, ...(result ? { lastRunAt: new Date() } : {}) },
  });
}

async function pollNewslettersOnce(): Promise<void> {
  await reapStaleNewsletterLocks();

  for (;;) {
    const claimed = await claimNextNewsletter();
    if (!claimed) break;
    await runNewsletterCycle(claimed.id);
  }
}

// --- Monday.com sync: one dirty contact at a time, same claim pattern as
// above. No lockedAt/stale-lock-reap here — unlike a multi-step send, a sync
// cycle is a single Monday API call, and this is best-effort background
// enrichment rather than the core send path, so a worker crash mid-call just
// means that contact waits for its next edit to re-sync rather than being
// automatically retried. Bounded iteration count guards against a large
// first-time "sync all" backlog blowing through Monday's per-minute
// complexity-based rate limit, which is stricter than this app's own
// internal DB-only polling ever had to account for.
const MAX_MONDAY_SYNCS_PER_TICK = 20;

async function claimNextDirtyContact(): Promise<ClaimedMondayContact | null> {
  const rows = await prisma.$queryRaw<ClaimedMondayContact[]>`
    WITH due AS (
      SELECT c.id
      FROM "Contact" c
      JOIN "MondayIntegration" m ON m."userId" = c."userId"
      WHERE c."mondayDirty" = true
        AND m."syncEnabled" = true
        AND m."boardId" IS NOT NULL
      ORDER BY c."updatedAt" ASC
      LIMIT 1
      FOR UPDATE OF c SKIP LOCKED
    )
    UPDATE "Contact"
    SET "mondayDirty" = false
    WHERE id IN (SELECT id FROM due)
    RETURNING id, "userId" as "userId"
  `;
  return rows[0] ?? null;
}

async function pollMondaySyncOnce(): Promise<void> {
  for (let i = 0; i < MAX_MONDAY_SYNCS_PER_TICK; i++) {
    const claimed = await claimNextDirtyContact();
    if (!claimed) break;
    await syncContactToMonday(claimed.userId, claimed.id);
  }
}

// --- Social posts: same claim/reap shape as CampaignRecipient above (a real
// PUBLISHING status, not just lockedAt) — SocialPost has meaningful distinct
// terminal states the way a CampaignRecipient does, unlike SequenceEnrollment
// or Newsletter. No per-user daily-limit/rate check here — social posting has
// no equivalent of email's daily send cap.

type ClaimedSocialPost = { id: string };

async function claimNextSocialPost(): Promise<ClaimedSocialPost | null> {
  const rows = await prisma.$queryRaw<ClaimedSocialPost[]>`
    WITH due AS (
      SELECT p.id
      FROM "SocialPost" p
      WHERE p.status = 'SCHEDULED'
        AND p."scheduledAt" <= now()
      ORDER BY p."scheduledAt" ASC
      LIMIT 1
      FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE "SocialPost"
    SET status = 'PUBLISHING', "lockedAt" = now()
    WHERE id IN (SELECT id FROM due)
    RETURNING id
  `;
  return rows[0] ?? null;
}

async function reapStalePublishingLocks(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "SocialPost"
    SET status = 'SCHEDULED', "lockedAt" = NULL
    WHERE status = 'PUBLISHING'
      AND "lockedAt" < now() - (${STALE_LOCK_MINUTES}::text || ' minutes')::interval
  `;
}

async function pollSocialPostsOnce(): Promise<void> {
  await reapStalePublishingLocks();

  for (;;) {
    const claimed = await claimNextSocialPost();
    if (!claimed) break;
    await publishSocialPost(claimed.id);
  }
}

export async function pollOnce(): Promise<void> {
  await pollCampaignsOnce();
  await pollSequencesOnce();
  await pollNewslettersOnce();
  await pollMondaySyncOnce();
  await pollSocialPostsOnce();
}
