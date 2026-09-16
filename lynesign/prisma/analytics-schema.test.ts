import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db/root";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const block = (name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))![0];

describe("playback event schema", () => {
  it("declares the model", () => {
    expect(schema).toMatch(/model PlaybackEvent \{/);
  });
  it("id is client-supplied (no @default) under a composite primary key", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/\n\s*id\s+String\s*\n/);
    expect(b).not.toMatch(/\n\s*id\s+String\s+@id/);
    expect(b).not.toMatch(/\n\s*id\s+String\s+@default/);
    expect(b).toMatch(/@@id\(\[organizationId, id\]\)/);
  });
  it("content fks are optional and SetNull", () => {
    const b = block("PlaybackEvent");
    for (const rel of ["mediaAsset", "playlist", "campaign", "scheduleRule"]) {
      expect(b).toMatch(new RegExp(`${rel}\\s+\\w+\\?\\s+@relation\\([^)]*onDelete:\\s*SetNull`));
    }
  });
  it("screen and organization cascade", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/screen\s+Screen\s+@relation\([^)]*onDelete:\s*Cascade/);
    expect(b).toMatch(/organization\s+Organization\s+@relation\([^)]*onDelete:\s*Cascade/);
  });
  it("has the airedAt composite indexes", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/@@index\(\[organizationId, airedAt\]\)/);
    expect(b).toMatch(/@@index\(\[organizationId, mediaAssetId, airedAt\]\)/);
  });
  it("declares every airedAt composite index and the screen one", () => {
    const b = block("PlaybackEvent");
    expect(b).toMatch(/@@index\(\[organizationId, campaignId, airedAt\]\)/);
    expect(b).toMatch(/@@index\(\[organizationId, scheduleRuleId, airedAt\]\)/);
    expect(b).toMatch(/@@index\(\[screenId, airedAt\]\)/);
  });
});

const slug = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("playback event CHECK and FK behaviour (live dev DB)", () => {
  let orgId: string;
  let locationId: string;
  let screenId: string;
  let mediaAssetId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: "pbe-test", slug: slug("pbe") } });
    orgId = org.id;
    const location = await prisma.location.create({ data: { organizationId: orgId, name: "loc" } });
    locationId = location.id;
    const screen = await prisma.screen.create({
      data: { organizationId: orgId, locationId, name: "screen" },
    });
    screenId = screen.id;
    const asset = await prisma.mediaAsset.create({
      data: { organizationId: orgId, kind: "IMAGE", name: "asset" },
    });
    mediaAssetId = asset.id;
  });

  afterEach(async () => {
    await prisma.playbackEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.mediaAsset.deleteMany({ where: { organizationId: orgId } });
    await prisma.screen.deleteMany({ where: { organizationId: orgId } });
    await prisma.location.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  const baseEvent = (over: Record<string, unknown> = {}) => ({
    id: slug("evt"),
    organizationId: orgId,
    screenId,
    source: "playlist",
    airedAt: new Date("2026-09-02T10:00:00Z"),
    durationSeconds: 30,
    ...over,
  });

  it("rejects a negative durationSeconds", async () => {
    await expect(
      prisma.playbackEvent.create({ data: baseEvent({ durationSeconds: -1 }) }),
    ).rejects.toThrow(/playback_event_duration_nonneg/);
  });

  it("rejects a durationSeconds beyond one day", async () => {
    await expect(
      prisma.playbackEvent.create({ data: baseEvent({ durationSeconds: 86401 }) }),
    ).rejects.toThrow(/playback_event_duration_nonneg/);
  });

  it("accepts the inclusive bounds 0 and 86400", async () => {
    await expect(
      prisma.playbackEvent.create({ data: baseEvent({ durationSeconds: 0 }) }),
    ).resolves.toMatchObject({ durationSeconds: 0 });
    await expect(
      prisma.playbackEvent.create({ data: baseEvent({ durationSeconds: 86400 }) }),
    ).resolves.toMatchObject({ durationSeconds: 86400 });
  });

  it("stores an event under its client-supplied id and treats a replay as a no-op", async () => {
    const id = slug("evt");
    await prisma.playbackEvent.create({ data: baseEvent({ id }) });

    const stored = await prisma.playbackEvent.findFirst({ where: { id } });
    expect(stored?.id).toBe(id);

    const replay = await prisma.playbackEvent.createMany({
      data: [baseEvent({ id })],
      skipDuplicates: true,
    });
    expect(replay.count).toBe(0);
  });

  it("lets two organizations each hold an event with the same client-supplied id", async () => {
    const org2 = await prisma.organization.create({
      data: { name: "pbe-test-2", slug: slug("pbe2") },
    });
    const loc2 = await prisma.location.create({
      data: { organizationId: org2.id, name: "loc2" },
    });
    const screen2 = await prisma.screen.create({
      data: { organizationId: org2.id, locationId: loc2.id, name: "screen2" },
    });

    try {
      const sharedId = slug("shared");
      await prisma.playbackEvent.create({ data: baseEvent({ id: sharedId }) });
      await prisma.playbackEvent.create({
        data: baseEvent({ id: sharedId, organizationId: org2.id, screenId: screen2.id }),
      });

      const rows = await prisma.playbackEvent.findMany({ where: { id: sharedId } });
      expect(rows.map((r) => r.organizationId).sort()).toEqual([orgId, org2.id].sort());
    } finally {
      await prisma.playbackEvent.deleteMany({ where: { organizationId: org2.id } });
      await prisma.screen.deleteMany({ where: { organizationId: org2.id } });
      await prisma.location.deleteMany({ where: { organizationId: org2.id } });
      await prisma.organization.deleteMany({ where: { id: org2.id } });
    }
  });

  it("nulls mediaAssetId when the referenced MediaAsset is deleted, keeping the event", async () => {
    const id = slug("evt");
    await prisma.playbackEvent.create({ data: baseEvent({ id, mediaAssetId }) });

    await prisma.mediaAsset.delete({ where: { id: mediaAssetId } });

    const after = await prisma.playbackEvent.findFirst({ where: { id } });
    expect(after).not.toBeNull();
    expect(after?.mediaAssetId).toBeNull();
  });

  it("cascades the event away when its Screen is deleted", async () => {
    const id = slug("evt");
    await prisma.playbackEvent.create({ data: baseEvent({ id }) });

    await prisma.screen.delete({ where: { id: screenId } });

    const after = await prisma.playbackEvent.findFirst({ where: { id } });
    expect(after).toBeNull();
  });
});
