import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const block = (name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))![0];

describe("schedule schema", () => {
  it("declares the three models", () => {
    expect(schema).toMatch(/model ScheduleRule \{/);
    expect(schema).toMatch(/model ScheduleRuleScreen \{/);
    expect(schema).toMatch(/model ScheduleRuleLocation \{/);
  });
  it("ScheduleRule has the payload FKs as optional Restrict", () => {
    const b = block("ScheduleRule");
    expect(b).toMatch(/playlistId\s+String\?/);
    expect(b).toMatch(/campaignId\s+String\?/);
    expect(b).toMatch(/playlist\s+Playlist\?\s+@relation\([^)]*onDelete:\s*Restrict/);
    expect(b).toMatch(/campaign\s+Campaign\?\s+@relation\([^)]*onDelete:\s*Restrict/);
  });
  it("ScheduleRule stores days as an int array and a revision", () => {
    const b = block("ScheduleRule");
    expect(b).toMatch(/daysOfWeek\s+Int\[\]/);
    expect(b).toMatch(/startMinute\s+Int/);
    expect(b).toMatch(/endMinute\s+Int/);
    expect(b).toMatch(/effectiveFrom\s+DateTime\?\s+@db\.Date/);
    expect(b).toMatch(/revision\s+Int\s+@default\(1\)/);
  });
  it("join tables carry composite unique keys", () => {
    expect(schema).toMatch(/@@unique\(\[scheduleRuleId, screenId\]\)/);
    expect(schema).toMatch(/@@unique\(\[scheduleRuleId, locationId\]\)/);
  });
});

const prisma = new PrismaClient();
const slug = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("schedule rule CHECK and FK behaviour (live dev DB)", () => {
  let orgId: string;
  let playlistId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: "sched-test", slug: slug("sched") } });
    orgId = org.id;
    const playlist = await prisma.playlist.create({ data: { organizationId: orgId, name: "payload" } });
    playlistId = playlist.id;
  });

  afterEach(async () => {
    await prisma.scheduleRule.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
    await prisma.playlist.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  const baseRule = () => ({
    organizationId: orgId,
    daysOfWeek: [1, 2, 3],
    startMinute: 540,
    endMinute: 1020,
  });

  it("rejects a rule that names neither a playlist nor a campaign", async () => {
    await expect(prisma.scheduleRule.create({ data: { ...baseRule() } })).rejects.toThrow(
      /schedule_rule_payload_xor/,
    );
  });

  it("rejects a rule that names both a playlist and a campaign", async () => {
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: orgId,
        name: "both",
        playlistId,
        startsAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-02T00:00:00Z"),
      },
    });
    await expect(
      prisma.scheduleRule.create({ data: { ...baseRule(), playlistId, campaignId: campaign.id } }),
    ).rejects.toThrow(/schedule_rule_payload_xor/);
  });

  it("rejects a rule whose endMinute is not after startMinute", async () => {
    await expect(
      prisma.scheduleRule.create({ data: { ...baseRule(), playlistId, startMinute: 600, endMinute: 600 } }),
    ).rejects.toThrow(/schedule_rule_minute_bounds/);
  });

  it("blocks deleting a playlist a rule references, and allows it once the rule is gone", async () => {
    const rule = await prisma.scheduleRule.create({ data: { ...baseRule(), playlistId } });

    await expect(prisma.playlist.delete({ where: { id: playlistId } })).rejects.toThrow(
      /foreign key|P2003/i,
    );

    await prisma.scheduleRule.delete({ where: { id: rule.id } });
    await expect(prisma.playlist.delete({ where: { id: playlistId } })).resolves.toMatchObject({
      id: playlistId,
    });
  });
});
