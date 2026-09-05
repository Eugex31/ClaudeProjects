import { describe, it, expect, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { resetDb, seedPlans } from "@/test/helpers/db";
import { getPlaybackSummary } from "@/lib/analytics/summary";
import { getContentPerformance } from "@/lib/analytics/content";
import { getCampaignProofOfPlay, getScheduleProofOfPlay } from "@/lib/analytics/proof-of-play";

/**
 * Task 6 covers the first two read-time reporting aggregates over
 * `PlaybackEvent`: `getPlaybackSummary` (four scalar totals) and
 * `getContentPerformance` (per-asset rows plus a zero-filled per-day series).
 *
 * The fixture is one org, two locations (A with screens 1 and 2, B with screen
 * 3), two media assets, and twelve `PlaybackEvent` rows spread across five
 * consecutive UTC days. Two of the twelve carry no `mediaAssetId`. Every
 * expected total below is computed by hand from this table:
 *
 *   id   screen  asset   airedAt (UTC)          durationSeconds
 *   e01  S1      M1      2026-09-01T08:00:00Z   30
 *   e02  S1      M2      2026-09-01T09:00:00Z   60
 *   e03  S2      M1      2026-09-01T10:00:00Z   15
 *   e04  S2      M2      2026-09-02T08:00:00Z   45
 *   e05  S3      M1      2026-09-02T12:00:00Z   20
 *   e06  S1      -       2026-09-03T08:00:00Z   10
 *   e07  S3      M2      2026-09-03T14:00:00Z   50
 *   e08  S1      M1      2026-09-04T08:00:00Z   30
 *   e09  S2      M1      2026-09-04T09:00:00Z   25
 *   e10  S2      -       2026-09-04T10:00:00Z    5
 *   e11  S1      M2      2026-09-05T08:00:00Z   60
 *   e12  S3      M1      2026-09-05T20:00:00Z   20
 *
 * Task 7 (proof-of-play) layers rule attribution onto the same twelve rows
 * without adding or removing any, so every Task 6 total above still holds:
 *
 *   campaign "Autumn Push" (c1):  e01 e03 e05 e08
 *   campaign "Winter Teaser" (c2): e04 e09, then c2 is deleted in the fixture so
 *                                  SetNull clears campaignId on e04 and e09
 *   campaign "Borealis Ad" (c3):  e11 e12
 *   campaign "Ghost" (org2):      e07 only; a cross-tenant campaign row that the
 *                                  org-scoped name lookup cannot see, so its
 *                                  group forms in SQL and is then dropped
 *   schedule rule "Evening Loop": e02 e04 e05 e07 e10
 */

const FROM = new Date("2026-09-01T00:00:00.000Z");
const TO = new Date("2026-09-06T00:00:00.000Z");

let orgId = "";
let locAId = "";
let locBId = "";
let s1Id = "";
let s2Id = "";
let m1Id = "";
let m2Id = "";
let c1Id = "";
let c3Id = "";
let ruleId = "";

beforeEach(async () => {
  await resetDb();
  await seedPlans();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: "Analytics Org", slug: `analytics-${suffix}` },
  });
  await prisma.user.create({
    data: { email: `analytics-${suffix}@test.local`, name: "Tester" },
  });

  const locA = await prisma.location.create({
    data: { organizationId: org.id, name: "Location A" },
  });
  const locB = await prisma.location.create({
    data: { organizationId: org.id, name: "Location B" },
  });
  const s1 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: locA.id, name: "Screen 1" },
  });
  const s2 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: locA.id, name: "Screen 2" },
  });
  const s3 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: locB.id, name: "Screen 3" },
  });
  const m1 = await prisma.mediaAsset.create({
    data: { organizationId: org.id, kind: "IMAGE", status: "READY", name: "Alpha Image" },
  });
  const m2 = await prisma.mediaAsset.create({
    data: { organizationId: org.id, kind: "VIDEO", status: "READY", name: "Beta Video" },
  });

  // Task 7 fixture: campaigns and a schedule rule attributed to a subset of the
  // twelve events above. `startsAt` / `endsAt` only need to be valid columns.
  const campaignWindow = {
    startsAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2026-10-01T00:00:00.000Z"),
  };
  const playlist = await prisma.playlist.create({
    data: { organizationId: org.id, name: "Proof Playlist" },
  });
  const c1 = await prisma.campaign.create({
    data: { organizationId: org.id, name: "Autumn Push", playlistId: playlist.id, ...campaignWindow },
  });
  const c2 = await prisma.campaign.create({
    data: { organizationId: org.id, name: "Winter Teaser", playlistId: playlist.id, ...campaignWindow },
  });
  const c3 = await prisma.campaign.create({
    data: { organizationId: org.id, name: "Borealis Ad", playlistId: playlist.id, ...campaignWindow },
  });
  const rule = await prisma.scheduleRule.create({
    data: {
      organizationId: org.id,
      name: "Evening Loop",
      playlistId: playlist.id,
      daysOfWeek: [1, 2, 3, 4, 5],
      startMinute: 1020,
      endMinute: 1320,
    },
  });

  // A campaign in a different org, referenced by one event in this org. The FK
  // permits it; the org-scoped name lookup inside the report cannot see it, so
  // its group is dropped.
  const org2 = await prisma.organization.create({
    data: { name: "Other Org", slug: `other-${suffix}` },
  });
  const playlist2 = await prisma.playlist.create({
    data: { organizationId: org2.id, name: "Ghost Playlist" },
  });
  const ghost = await prisma.campaign.create({
    data: { organizationId: org2.id, name: "Ghost", playlistId: playlist2.id, ...campaignWindow },
  });

  orgId = org.id;
  locAId = locA.id;
  locBId = locB.id;
  s1Id = s1.id;
  s2Id = s2.id;
  m1Id = m1.id;
  m2Id = m2.id;
  c1Id = c1.id;
  c3Id = c3.id;
  ruleId = rule.id;

  await prisma.playbackEvent.createMany({
    data: [
      { id: `${suffix}-e01`, organizationId: org.id, screenId: s1.id, mediaAssetId: m1.id, campaignId: c1.id, source: "playlist", airedAt: new Date("2026-09-01T08:00:00.000Z"), durationSeconds: 30 },
      { id: `${suffix}-e02`, organizationId: org.id, screenId: s1.id, mediaAssetId: m2.id, scheduleRuleId: rule.id, source: "playlist", airedAt: new Date("2026-09-01T09:00:00.000Z"), durationSeconds: 60 },
      { id: `${suffix}-e03`, organizationId: org.id, screenId: s2.id, mediaAssetId: m1.id, campaignId: c1.id, source: "playlist", airedAt: new Date("2026-09-01T10:00:00.000Z"), durationSeconds: 15 },
      { id: `${suffix}-e04`, organizationId: org.id, screenId: s2.id, mediaAssetId: m2.id, campaignId: c2.id, scheduleRuleId: rule.id, source: "playlist", airedAt: new Date("2026-09-02T08:00:00.000Z"), durationSeconds: 45 },
      { id: `${suffix}-e05`, organizationId: org.id, screenId: s3.id, mediaAssetId: m1.id, campaignId: c1.id, scheduleRuleId: rule.id, source: "schedule", airedAt: new Date("2026-09-02T12:00:00.000Z"), durationSeconds: 20 },
      { id: `${suffix}-e06`, organizationId: org.id, screenId: s1.id, source: "playlist", airedAt: new Date("2026-09-03T08:00:00.000Z"), durationSeconds: 10 },
      { id: `${suffix}-e07`, organizationId: org.id, screenId: s3.id, mediaAssetId: m2.id, campaignId: ghost.id, scheduleRuleId: rule.id, source: "schedule", airedAt: new Date("2026-09-03T14:00:00.000Z"), durationSeconds: 50 },
      { id: `${suffix}-e08`, organizationId: org.id, screenId: s1.id, mediaAssetId: m1.id, campaignId: c1.id, source: "playlist", airedAt: new Date("2026-09-04T08:00:00.000Z"), durationSeconds: 30 },
      { id: `${suffix}-e09`, organizationId: org.id, screenId: s2.id, mediaAssetId: m1.id, campaignId: c2.id, source: "playlist", airedAt: new Date("2026-09-04T09:00:00.000Z"), durationSeconds: 25 },
      { id: `${suffix}-e10`, organizationId: org.id, screenId: s2.id, scheduleRuleId: rule.id, source: "playlist", airedAt: new Date("2026-09-04T10:00:00.000Z"), durationSeconds: 5 },
      { id: `${suffix}-e11`, organizationId: org.id, screenId: s1.id, mediaAssetId: m2.id, campaignId: c3.id, source: "playlist", airedAt: new Date("2026-09-05T08:00:00.000Z"), durationSeconds: 60 },
      { id: `${suffix}-e12`, organizationId: org.id, screenId: s3.id, mediaAssetId: m1.id, campaignId: c3.id, source: "schedule", airedAt: new Date("2026-09-05T20:00:00.000Z"), durationSeconds: 20 },
    ],
  });

  // "Winter Teaser" is deleted after its events were recorded. The FK is
  // onDelete: SetNull, so e04 and e09 keep their rows but lose campaignId and
  // fall out of the campaignId IS NOT NULL filter entirely.
  await prisma.campaign.delete({ where: { id: c2.id } });
});

describe("getPlaybackSummary", () => {
  it("returns exact totals over the whole range with no filter", async () => {
    const summary = await getPlaybackSummary(orgId, { from: FROM, to: TO });

    expect(summary).toEqual({
      totalPlays: 12,
      totalPlaySeconds: 370,
      reportingScreens: 3,
      distinctAssets: 2,
    });
  });

  it("locationId filter excludes the other location's events", async () => {
    // Location A keeps e01..e04, e06, e08..e11 (nine rows); drops S3's e05, e07, e12.
    const summary = await getPlaybackSummary(orgId, { from: FROM, to: TO, locationId: locAId });

    expect(summary).toEqual({
      totalPlays: 9,
      totalPlaySeconds: 280,
      reportingScreens: 2,
      distinctAssets: 2,
    });
  });

  it("locationId filter on B narrows to that location's three events", async () => {
    const summary = await getPlaybackSummary(orgId, { from: FROM, to: TO, locationId: locBId });

    expect(summary).toEqual({
      totalPlays: 3,
      totalPlaySeconds: 90,
      reportingScreens: 1,
      distinctAssets: 2,
    });
  });

  it("screenId filter narrows to a single screen", async () => {
    // Screen 1 keeps e02, e06, e08, e11 and e01: five rows, assets M1 and M2, one null.
    const summary = await getPlaybackSummary(orgId, { from: FROM, to: TO, screenId: s1Id });

    expect(summary).toEqual({
      totalPlays: 5,
      totalPlaySeconds: 190,
      reportingScreens: 1,
      distinctAssets: 2,
    });
  });

  it("honours the half-open range bounds", async () => {
    // from inclusive, to exclusive: a range that ends at day 5 00:00 drops e11 and e12.
    const summary = await getPlaybackSummary(orgId, {
      from: FROM,
      to: new Date("2026-09-05T00:00:00.000Z"),
    });

    expect(summary).toEqual({
      totalPlays: 10,
      totalPlaySeconds: 290,
      reportingScreens: 3,
      distinctAssets: 2,
    });
  });
});

describe("getContentPerformance", () => {
  it("returns per-asset rows with the null-asset rows collapsed into one", async () => {
    const { rows } = await getContentPerformance(orgId, { from: FROM, to: TO });

    expect(rows).toEqual([
      {
        mediaAssetId: m1Id,
        assetName: "Alpha Image",
        kind: "IMAGE",
        plays: 6,
        playSeconds: 140,
        screensReached: 3,
        lastAiredAt: "2026-09-05T20:00:00.000Z",
      },
      {
        mediaAssetId: m2Id,
        assetName: "Beta Video",
        kind: "VIDEO",
        plays: 4,
        playSeconds: 215,
        screensReached: 3,
        lastAiredAt: "2026-09-05T08:00:00.000Z",
      },
      {
        mediaAssetId: "",
        assetName: "Unattributed",
        kind: null,
        plays: 2,
        playSeconds: 15,
        screensReached: 2,
        lastAiredAt: "2026-09-04T10:00:00.000Z",
      },
    ]);
  });

  it("orders rows by plays desc then assetName asc", async () => {
    // Narrowed to Screen 2: M1 has two plays; M2 and the null row have one each,
    // so the tie breaks on name and "Beta Video" sorts before "Unattributed".
    const { rows } = await getContentPerformance(orgId, { from: FROM, to: TO, screenId: s2Id });

    expect(rows.map((r) => [r.mediaAssetId, r.plays])).toEqual([
      [m1Id, 2],
      [m2Id, 1],
      ["", 1],
    ]);
  });

  it("zero-fills byDay across every UTC day in the range, ascending", async () => {
    const { byDay } = await getContentPerformance(orgId, { from: FROM, to: TO });

    expect(byDay).toEqual([
      { date: "2026-09-01", plays: 3 },
      { date: "2026-09-02", plays: 2 },
      { date: "2026-09-03", plays: 2 },
      { date: "2026-09-04", plays: 3 },
      { date: "2026-09-05", plays: 2 },
    ]);
  });

  it("applies the location filter to both rows and byDay", async () => {
    const { rows, byDay } = await getContentPerformance(orgId, {
      from: FROM,
      to: TO,
      locationId: locBId,
    });

    expect(rows).toEqual([
      {
        mediaAssetId: m1Id,
        assetName: "Alpha Image",
        kind: "IMAGE",
        plays: 2,
        playSeconds: 40,
        screensReached: 1,
        lastAiredAt: "2026-09-05T20:00:00.000Z",
      },
      {
        mediaAssetId: m2Id,
        assetName: "Beta Video",
        kind: "VIDEO",
        plays: 1,
        playSeconds: 50,
        screensReached: 1,
        lastAiredAt: "2026-09-03T14:00:00.000Z",
      },
    ]);

    expect(byDay).toEqual([
      { date: "2026-09-01", plays: 0 },
      { date: "2026-09-02", plays: 1 },
      { date: "2026-09-03", plays: 1 },
      { date: "2026-09-04", plays: 0 },
      { date: "2026-09-05", plays: 1 },
    ]);
  });
});

describe("getCampaignProofOfPlay", () => {
  it("proves the surviving campaigns and drops the ones that no longer resolve", async () => {
    const rows = await getCampaignProofOfPlay(orgId, { from: FROM, to: TO });

    // "Winter Teaser" was deleted (campaignId nulled on e04/e09); "Ghost" lives
    // in another org so its group forms in SQL then fails the name lookup. Only
    // "Autumn Push" and "Borealis Ad" survive, ordered by airings desc.
    expect(rows).toEqual([
      {
        id: c1Id,
        name: "Autumn Push",
        airings: 4,
        playSeconds: 95,
        screensReached: 3,
        locationsReached: 2,
        firstAiredAt: "2026-09-01T08:00:00.000Z",
        lastAiredAt: "2026-09-04T08:00:00.000Z",
      },
      {
        id: c3Id,
        name: "Borealis Ad",
        airings: 2,
        playSeconds: 80,
        screensReached: 2,
        locationsReached: 2,
        firstAiredAt: "2026-09-05T08:00:00.000Z",
        lastAiredAt: "2026-09-05T20:00:00.000Z",
      },
    ]);
    expect(rows.some((r) => r.name === "Ghost" || r.name === "Winter Teaser")).toBe(false);
  });

  it("narrows screensReached and locationsReached to the filtered location", async () => {
    // Location A keeps c1's e01/e03/e08 (S1, S2) and c3's e11 (S1); S3/Location B
    // events drop out.
    const rows = await getCampaignProofOfPlay(orgId, { from: FROM, to: TO, locationId: locAId });

    expect(rows).toEqual([
      {
        id: c1Id,
        name: "Autumn Push",
        airings: 3,
        playSeconds: 75,
        screensReached: 2,
        locationsReached: 1,
        firstAiredAt: "2026-09-01T08:00:00.000Z",
        lastAiredAt: "2026-09-04T08:00:00.000Z",
      },
      {
        id: c3Id,
        name: "Borealis Ad",
        airings: 1,
        playSeconds: 60,
        screensReached: 1,
        locationsReached: 1,
        firstAiredAt: "2026-09-05T08:00:00.000Z",
        lastAiredAt: "2026-09-05T08:00:00.000Z",
      },
    ]);
  });

  it("breaks an equal-airings tie by name ascending", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await prisma.organization.create({
      data: { name: "Tie Org", slug: `tie-${suffix}` },
    });
    const loc = await prisma.location.create({
      data: { organizationId: org.id, name: "Tie Loc" },
    });
    const screen = await prisma.screen.create({
      data: { organizationId: org.id, locationId: loc.id, name: "Tie Screen" },
    });
    const playlist = await prisma.playlist.create({
      data: { organizationId: org.id, name: "Tie Playlist" },
    });
    const win = {
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    // Inserted Z before A; each gets exactly one airing, so only the name breaks the tie.
    const zeta = await prisma.campaign.create({
      data: { organizationId: org.id, name: "Zeta Campaign", playlistId: playlist.id, ...win },
    });
    const alpha = await prisma.campaign.create({
      data: { organizationId: org.id, name: "Alpha Campaign", playlistId: playlist.id, ...win },
    });
    await prisma.playbackEvent.createMany({
      data: [
        { id: `${suffix}-t1`, organizationId: org.id, screenId: screen.id, campaignId: zeta.id, source: "campaign", airedAt: new Date("2026-09-02T08:00:00.000Z"), durationSeconds: 10 },
        { id: `${suffix}-t2`, organizationId: org.id, screenId: screen.id, campaignId: alpha.id, source: "campaign", airedAt: new Date("2026-09-02T09:00:00.000Z"), durationSeconds: 10 },
      ],
    });

    const rows = await getCampaignProofOfPlay(org.id, { from: FROM, to: TO });

    expect(rows.map((r) => r.name)).toEqual(["Alpha Campaign", "Zeta Campaign"]);
    expect(rows.map((r) => r.airings)).toEqual([1, 1]);
  });
});

describe("getScheduleProofOfPlay", () => {
  it("proves the schedule rule field by field", async () => {
    const rows = await getScheduleProofOfPlay(orgId, { from: FROM, to: TO });

    // "Evening Loop" is attributed to e02, e04, e05, e07, e10 across S1, S2, S3
    // and both locations.
    expect(rows).toEqual([
      {
        id: ruleId,
        name: "Evening Loop",
        airings: 5,
        playSeconds: 180,
        screensReached: 3,
        locationsReached: 2,
        firstAiredAt: "2026-09-01T09:00:00.000Z",
        lastAiredAt: "2026-09-04T10:00:00.000Z",
      },
    ]);
  });

  it("applies the location filter to the schedule rule totals", async () => {
    // Location B keeps only e05 and e07, both on Screen 3.
    const rows = await getScheduleProofOfPlay(orgId, { from: FROM, to: TO, locationId: locBId });

    expect(rows).toEqual([
      {
        id: ruleId,
        name: "Evening Loop",
        airings: 2,
        playSeconds: 70,
        screensReached: 1,
        locationsReached: 1,
        firstAiredAt: "2026-09-02T12:00:00.000Z",
        lastAiredAt: "2026-09-03T14:00:00.000Z",
      },
    ]);
  });
});
