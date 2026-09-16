import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import {
  assertCanAddScreen,
  assertCanAddStorage,
  getStorageUsage,
  getUsageSummary,
} from "@/lib/plan-limits";
import { PlanKey } from "@prisma/client";

async function orgOnPlan(key: PlanKey) {
  const org = await prisma.organization.create({ data: { name: "L", slug: `l-${Date.now()}-${Math.random()}` } });
  await prisma.subscription.create({ data: { organizationId: org.id, planKey: key } });
  return org;
}

describe("plan limits", () => {
  it("blocks a 4th screen on TRIAL (max 3)", async () => {
    const org = await orgOnPlan(PlanKey.TRIAL);
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    for (let i = 0; i < 3; i++) await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: `s${i}` } });
    await expect(assertCanAddScreen(org.id)).rejects.toThrow(/3 screens/);
  });
  it("ENTERPRISE has no screen ceiling", async () => {
    const org = await orgOnPlan(PlanKey.ENTERPRISE);
    await expect(assertCanAddScreen(org.id)).resolves.toBeUndefined();
  });
  it("summary reports used vs limit", async () => {
    const org = await orgOnPlan(PlanKey.STARTER);
    await prisma.mediaAsset.create({
      data: { organizationId: org.id, kind: "IMAGE", name: "x", status: "READY", sizeBytes: BigInt(2_000_000) },
    });
    const s = await getUsageSummary(org.id);
    expect(s.screens.limit).toBe(10);
    expect(s.screens.used).toBe(0);
    expect(s.storage.usedBytes).toBe(BigInt(2_000_000));
  });
  it("getStorageUsage sums READY and UPLOADING non-archived assets", async () => {
    const org = await orgOnPlan(PlanKey.STARTER); // maxStorageBytes 10 GiB
    const f = { organizationId: org.id, kind: "IMAGE" as const, name: "x" };
    await prisma.mediaAsset.createMany({
      data: [
        { ...f, status: "READY", sizeBytes: BigInt(3_000_000) },
        { ...f, status: "UPLOADING", sizeBytes: BigInt(1_000_000) },
        { ...f, status: "FAILED", sizeBytes: BigInt(9_000_000) },
        { ...f, status: "READY", sizeBytes: BigInt(5_000_000), archivedAt: new Date() },
      ],
    });
    const u = await getStorageUsage(org.id);
    expect(u.usedBytes).toBe(BigInt(4_000_000));
  });
  it("assertCanAddStorage throws past the limit and is unlimited on ENTERPRISE", async () => {
    const trial = await orgOnPlan(PlanKey.TRIAL); // 1 GiB
    await prisma.mediaAsset.create({
      data: {
        organizationId: trial.id,
        kind: "VIDEO",
        name: "v",
        status: "READY",
        sizeBytes: BigInt(1_000_000_000),
      },
    });
    await expect(assertCanAddStorage(trial.id, BigInt(200_000_000))).rejects.toThrow(/storage/i);
    const ent = await orgOnPlan(PlanKey.ENTERPRISE);
    await expect(assertCanAddStorage(ent.id, BigInt(9_999_999_999))).resolves.toBeUndefined();
  });
});
