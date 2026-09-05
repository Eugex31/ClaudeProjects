// Pure resolution of what a single screen should play at a single instant, given
// the campaigns that could apply to it. No I/O, no network, no database. The
// function never throws and does not inspect playlist health: a candidate that
// points at an archived playlist still wins.
//
// Precedence, highest first:
//   1. active campaign  -- a campaign that targets this screen and covers now
//   2. schedule rule    -- a matching rule the caller already resolved to a playlist
//   3. canvas           -- Screen.canvasId or args.canvas
//   4. base playlist    -- Screen.playlistId
//   5. none             -- nothing to play

export type ScreenContent =
  | {
      source: "campaign";
      campaignId: string;
      campaignName: string;
      campaignRevision: number;
      campaignEndsAt: string; // ISO string, campaign.endsAt.toISOString()
      playlistId: string;
    }
  | {
      source: "schedule";
      scheduleRuleId: string;
      scheduleRuleName: string | null;
      scheduleRuleRevision: number;
      playlistId: string;
      campaignId: string | null;
      campaignName: string | null;
      campaignRevision: number | null;
    }
  | { source: "canvas"; canvasId: string }
  | { source: "playlist"; playlistId: string }
  | { source: "none" };

/**
 * The already-resolved schedule winner passed into {@link resolveScreenContent}:
 * a rule that a caller matched to an effective playlist, plus the campaign
 * identity when the rule's payload is a campaign. `null` when no rule won.
 */
export type ScheduleResolutionInput = {
  ruleId: string;
  ruleName: string | null;
  ruleRevision: number;
  playlistId: string;
  campaignId: string | null;
  campaignName: string | null;
  campaignRevision: number | null;
};

interface CampaignLike {
  id: string;
  name: string;
  revision: number;
  playlistId: string;
  priority: number;
  startsAt: Date;
  endsAt: Date;
  enabled: boolean;
  archivedAt: Date | null;
  screenIds: string[]; // from CampaignScreen
  locationIds: string[]; // from CampaignLocation
}

export function resolveScreenContent(args: {
  screen: { id: string; locationId: string; playlistId: string | null };
  now: Date;
  campaigns: CampaignLike[];
  schedule?: ScheduleResolutionInput | null;
  canvas?: { canvasId: string } | null;
}): ScreenContent {
  const { screen, now, campaigns } = args;
  const nowMs = now.getTime();

  const candidates = campaigns.filter((c) => {
    if (!c.enabled) return false;
    if (c.archivedAt != null) return false;
    if (c.startsAt.getTime() > nowMs) return false;
    if (c.endsAt.getTime() <= nowMs) return false;
    return c.screenIds.includes(screen.id) || c.locationIds.includes(screen.locationId);
  });

  if (candidates.length > 0) {
    const winner = candidates.reduce((best, c) => (isBetter(c, best) ? c : best));
    return {
      source: "campaign",
      campaignId: winner.id,
      campaignName: winner.name,
      campaignRevision: winner.revision,
      campaignEndsAt: winner.endsAt.toISOString(),
      playlistId: winner.playlistId,
    };
  }

  if (args.schedule != null) {
    const s = args.schedule;
    return {
      source: "schedule",
      scheduleRuleId: s.ruleId,
      scheduleRuleName: s.ruleName,
      scheduleRuleRevision: s.ruleRevision,
      playlistId: s.playlistId,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      campaignRevision: s.campaignRevision,
    };
  }

  if (args.canvas != null) {
    return { source: "canvas", canvasId: args.canvas.canvasId };
  }

  if (screen.playlistId != null) {
    return { source: "playlist", playlistId: screen.playlistId };
  }

  return { source: "none" };
}

// True when a ranks strictly above b: higher priority, then earlier endsAt, then
// lower id (string comparison), so the result is deterministic on identical input.
function isBetter(a: CampaignLike, b: CampaignLike): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;

  const aEnds = a.endsAt.getTime();
  const bEnds = b.endsAt.getTime();
  if (aEnds !== bEnds) return aEnds < bEnds;

  return a.id < b.id;
}
