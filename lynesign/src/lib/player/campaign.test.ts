import { describe, it, expect } from "vitest";
import { resolveScreenContent } from "@/lib/player/campaign";

type Args = Parameters<typeof resolveScreenContent>[0];
type CampaignLike = Args["campaigns"][number];

const now = new Date("2026-09-05T12:00:00.000Z");
const screen = { id: "s1", locationId: "loc1", playlistId: "base-pl" as string | null };

let seq = 0;
function campaign(over: Partial<CampaignLike> = {}): CampaignLike {
  seq += 1;
  return {
    id: `c${seq}`,
    name: `Campaign ${seq}`,
    revision: 1,
    playlistId: `pl-${seq}`,
    priority: 0,
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-09-10T00:00:00.000Z"),
    enabled: true,
    archivedAt: null,
    screenIds: [],
    locationIds: [],
    ...over,
  };
}

function run(over: Partial<Args> = {}) {
  return resolveScreenContent({ screen, now, campaigns: [], ...over });
}

describe("resolveScreenContent", () => {
  it("falls back to the screen playlist when there are no campaigns", () => {
    expect(run()).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("returns none when there are no campaigns and no screen playlist", () => {
    expect(run({ screen: { ...screen, playlistId: null } })).toEqual({ source: "none" });
  });

  it("resolves a single candidate targeting the screen by id", () => {
    const c = campaign({ screenIds: ["s1"] });
    expect(run({ campaigns: [c] })).toEqual({
      source: "campaign",
      campaignId: c.id,
      campaignName: c.name,
      campaignRevision: c.revision,
      campaignEndsAt: "2026-09-10T00:00:00.000Z",
      playlistId: c.playlistId,
    });
  });

  it("resolves a single candidate targeting the screen by location", () => {
    const c = campaign({ locationIds: ["loc1"] });
    const out = run({ campaigns: [c] });
    expect(out).toMatchObject({ source: "campaign", campaignId: c.id, playlistId: c.playlistId });
  });

  it("ignores a campaign that targets a different screen and location", () => {
    const c = campaign({ screenIds: ["other"], locationIds: ["other"] });
    expect(run({ campaigns: [c] })).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("ignores a disabled campaign", () => {
    const c = campaign({ screenIds: ["s1"], enabled: false });
    expect(run({ campaigns: [c] })).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("ignores an archived campaign", () => {
    const c = campaign({ screenIds: ["s1"], archivedAt: new Date("2026-09-02T00:00:00.000Z") });
    expect(run({ campaigns: [c] })).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("treats startsAt exactly equal to now as a candidate", () => {
    const c = campaign({ screenIds: ["s1"], startsAt: now });
    expect(run({ campaigns: [c] })).toMatchObject({ source: "campaign", campaignId: c.id });
  });

  it("treats endsAt exactly equal to now as not a candidate (half-open)", () => {
    const c = campaign({ screenIds: ["s1"], endsAt: now });
    expect(run({ campaigns: [c] })).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("picks the highest priority among candidates", () => {
    const lo = campaign({ screenIds: ["s1"], priority: 5 });
    const hi = campaign({ screenIds: ["s1"], priority: 10 });
    expect(run({ campaigns: [lo, hi] })).toMatchObject({ source: "campaign", campaignId: hi.id });
  });

  it("breaks a priority tie by the earliest endsAt", () => {
    const early = campaign({ screenIds: ["s1"], endsAt: new Date("2026-09-08T00:00:00.000Z") });
    const late = campaign({ screenIds: ["s1"], endsAt: new Date("2026-09-12T00:00:00.000Z") });
    expect(run({ campaigns: [late, early] })).toMatchObject({
      source: "campaign",
      campaignId: early.id,
      campaignEndsAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("breaks a priority and endsAt tie by the lowest id", () => {
    const a = campaign({ id: "a", screenIds: ["s1"] });
    const b = campaign({ id: "b", screenIds: ["s1"] });
    expect(run({ campaigns: [b, a] })).toMatchObject({ source: "campaign", campaignId: "a" });
  });
});

type Schedule = NonNullable<Args["schedule"]>;

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    ruleId: "rule-1",
    ruleName: "Weekday mornings",
    ruleRevision: 3,
    playlistId: "sched-pl",
    campaignId: null,
    campaignName: null,
    campaignRevision: null,
    ...over,
  };
}

describe("schedule tier", () => {
  it("lets an active campaign win even when a schedule rule is provided", () => {
    const c = campaign({ screenIds: ["s1"] });
    expect(run({ campaigns: [c], schedule: schedule() })).toMatchObject({
      source: "campaign",
      campaignId: c.id,
      playlistId: c.playlistId,
    });
  });

  it("returns the schedule variant with null campaign fields when the rule points at a playlist", () => {
    expect(run({ schedule: schedule({ campaignId: null, ruleRevision: 7 }) })).toEqual({
      source: "schedule",
      scheduleRuleId: "rule-1",
      scheduleRuleName: "Weekday mornings",
      scheduleRuleRevision: 7,
      playlistId: "sched-pl",
      campaignId: null,
      campaignName: null,
      campaignRevision: null,
    });
  });

  it("returns the schedule variant with campaign fields populated when the rule points at a campaign", () => {
    const out = run({
      schedule: schedule({
        playlistId: "camp-pl",
        campaignId: "camp-9",
        campaignName: "Autumn push",
        campaignRevision: 4,
      }),
    });
    expect(out).toEqual({
      source: "schedule",
      scheduleRuleId: "rule-1",
      scheduleRuleName: "Weekday mornings",
      scheduleRuleRevision: 3,
      playlistId: "camp-pl",
      campaignId: "camp-9",
      campaignName: "Autumn push",
      campaignRevision: 4,
    });
  });

  it("falls through to the screen playlist when schedule is null", () => {
    expect(run({ schedule: null })).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("treats an omitted schedule the same as null", () => {
    expect(run()).toEqual({ source: "playlist", playlistId: "base-pl" });
  });
});

describe("canvas tier", () => {
  it("returns canvas when provided with no campaign or schedule", () => {
    expect(run({ canvas: { canvasId: "canvas-1" } })).toEqual({
      source: "canvas",
      canvasId: "canvas-1",
    });
  });

  it("lets an active campaign win even when canvas is provided", () => {
    const c = campaign({ screenIds: ["s1"] });
    expect(run({ campaigns: [c], canvas: { canvasId: "canvas-1" } })).toMatchObject({
      source: "campaign",
      campaignId: c.id,
    });
  });

  it("lets a schedule rule win even when canvas is provided", () => {
    expect(run({ schedule: schedule(), canvas: { canvasId: "canvas-1" } })).toMatchObject({
      source: "schedule",
      scheduleRuleId: "rule-1",
    });
  });

  it("falls through to the screen playlist when canvas is null", () => {
    expect(run({ canvas: null })).toEqual({ source: "playlist", playlistId: "base-pl" });
  });

  it("returns canvas when provided, even when screen playlist also exists", () => {
    expect(run({ canvas: { canvasId: "canvas-2" } })).toEqual({
      source: "canvas",
      canvasId: "canvas-2",
    });
  });

  it("treats an omitted canvas the same as null", () => {
    expect(run()).toEqual({ source: "playlist", playlistId: "base-pl" });
  });
});
