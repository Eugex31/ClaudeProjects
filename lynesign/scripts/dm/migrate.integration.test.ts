import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/root";
import { runMigration, type RunMigrationResult } from "../migrate-displaymonkey";
import { normalizeDump } from "./map";

const FIXTURE = "scripts/fixtures/displaymonkey.sample.json";
const dump = normalizeDump(JSON.parse(readFileSync(FIXTURE, "utf8")));

const expectedCounts = {
  locations: dump.levels.length + dump.locations.length,
  screens: dump.displays.length,
  canvases: dump.canvases.length,
  panels: dump.panels.length,
  frames: dump.frames.length,
  frameLocations: dump.frameLocations.length,
  content: dump.frames.length,
  memberships: dump.users.length,
  legacyIntegrations: dump.azureAccounts.length,
};

async function destCounts(organizationId: string) {
  const where = { organizationId };
  const [
    locations,
    screens,
    canvases,
    panels,
    frames,
    frameLocations,
    content,
    memberships,
    legacyIntegrations,
    clocks,
    pictures,
    htmls,
  ] = await Promise.all([
    prisma.location.count({ where }),
    prisma.screen.count({ where }),
    prisma.canvas.count({ where }),
    prisma.panel.count({ where }),
    prisma.frame.count({ where }),
    prisma.frameLocation.count({ where }),
    prisma.content.count({ where }),
    prisma.membership.count({ where }),
    prisma.legacyIntegration.count({ where }),
    prisma.clock.count({ where }),
    prisma.picture.count({ where }),
    prisma.html.count({ where }),
  ]);
  return {
    locations,
    screens,
    canvases,
    panels,
    frames,
    frameLocations,
    content,
    memberships,
    legacyIntegrations,
    clocks,
    pictures,
    htmls,
  };
}

describe("Display Monkey migration (integration)", () => {
  let first: RunMigrationResult;

  beforeAll(async () => {
    first = await runMigration({ fixture: FIXTURE, orgName: "DM Integration Test" });
  }, 30_000);

  it("reports all tables reconciled after the first run", () => {
    expect(first.ok).toBe(true);
    expect(first.report.every((r) => r.ok)).toBe(true);
    expect(first.report.find((r) => r.table === "locations")).toMatchObject({
      source: expectedCounts.locations,
      destination: expectedCounts.locations,
    });
  });

  it("writes destination rows that match the fixture", async () => {
    const c = await destCounts(first.organizationId);
    expect(c.locations).toBe(expectedCounts.locations);
    expect(c.screens).toBe(expectedCounts.screens);
    expect(c.canvases).toBe(expectedCounts.canvases);
    expect(c.panels).toBe(expectedCounts.panels);
    expect(c.frames).toBe(expectedCounts.frames);
    expect(c.frameLocations).toBe(expectedCounts.frameLocations);
    expect(c.content).toBe(expectedCounts.content);
    expect(c.memberships).toBe(expectedCounts.memberships);
    expect(c.legacyIntegrations).toBe(expectedCounts.legacyIntegrations);
    // typed detail rows for the three fixture frames (types 0/1/4).
    expect(c.clocks).toBe(1);
    expect(c.pictures).toBe(1);
    expect(c.htmls).toBe(1);
  });

  it("drops Display.Host and marks every screen UNPAIRED", async () => {
    const screens = await prisma.screen.findMany({ where: { organizationId: first.organizationId } });
    expect(screens.length).toBe(expectedCounts.screens);
    expect(screens.every((s) => s.status === "UNPAIRED")).toBe(true);
    expect(screens.every((s) => s.deviceTokenHash === null)).toBe(true);
  });

  it("discards Display Monkey plaintext passwords", async () => {
    const memberships = await prisma.membership.findMany({
      where: { organizationId: first.organizationId },
      include: { user: true },
    });
    expect(memberships.length).toBeGreaterThan(0);
    expect(memberships.every((m) => m.user.hashedPassword === null)).toBe(true);
    expect(memberships.every((m) => m.user.mustResetPassword === true)).toBe(true);
    const roles = memberships.map((m) => m.role).sort();
    expect(roles).toEqual(["ADMIN", "VIEWER"]);
  });

  it("builds the Location tree with the Level as the root", async () => {
    const locations = await prisma.location.findMany({ where: { organizationId: first.organizationId } });
    const roots = locations.filter((l) => l.parentId === null);
    const children = locations.filter((l) => l.parentId !== null);
    expect(roots.length).toBe(1);
    expect(children.length).toBe(2);
    expect(children.every((c) => c.parentId === roots[0].id)).toBe(true);
  });

  it("is idempotent: a second run does not duplicate and stays reconciled", async () => {
    const before = await destCounts(first.organizationId);
    const second = await runMigration({ fixture: FIXTURE, orgName: "DM Integration Test" });
    expect(second.organizationId).toBe(first.organizationId);
    expect(second.ok).toBe(true);
    expect(second.report.every((r) => r.ok)).toBe(true);
    const after = await destCounts(first.organizationId);
    expect(after).toEqual(before);
  }, 30_000);
});
