import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { sweepOfflineScreens } from "@/worker/jobs/sweepOfflineScreens";

describe("sweepOfflineScreens", () => {
  it("flips a stale ONLINE screen to OFFLINE", async () => {
    const org = await prisma.organization.create({ data: { name: "Sw", slug: `sw-${Date.now()}` } });
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    const stale = await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "stale", status: "ONLINE", lastSeenAt: new Date(Date.now() - 3600_000), pollIntervalSeconds: 60 } });
    const fresh = await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "fresh", status: "ONLINE", lastSeenAt: new Date(), pollIntervalSeconds: 60 } });

    const res = await sweepOfflineScreens();
    expect(res.flipped).toBeGreaterThanOrEqual(1);
    expect((await prisma.screen.findUnique({ where: { id: stale.id } }))?.status).toBe("OFFLINE");
    expect((await prisma.screen.findUnique({ where: { id: fresh.id } }))?.status).toBe("ONLINE");
  });
});
