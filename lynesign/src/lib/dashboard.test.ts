import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { getDashboardData, formatBytes } from "@/lib/dashboard";

describe("getDashboardData", () => {
  it("counts screens by derived online/offline and flags onboarding", async () => {
    const org = await prisma.organization.create({
      data: { name: "Dash", slug: `dash-${Date.now()}-${Math.random()}` },
    });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    await prisma.screen.create({
      data: {
        organizationId: org.id,
        locationId: loc.id,
        name: "fresh",
        status: "ONLINE",
        lastSeenAt: new Date(),
        pollIntervalSeconds: 60,
      },
    });
    await prisma.screen.create({
      data: {
        organizationId: org.id,
        locationId: loc.id,
        name: "stale",
        status: "ONLINE",
        lastSeenAt: new Date(Date.now() - 3600_000),
        pollIntervalSeconds: 60,
      },
    });

    const d = await getDashboardData(org.id);
    expect(d.screens.total).toBe(2);
    expect(d.screens.online).toBe(1);
    expect(d.screens.offline).toBe(1);
    expect(d.onboarding.hasLocation).toBe(true);
    expect(d.onboarding.hasPairedScreen).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats zero and scaled units", () => {
    expect(formatBytes(BigInt(0))).toBe("0 B");
    expect(formatBytes(BigInt(1610612736))).toBe("1.5 GB");
  });
});
