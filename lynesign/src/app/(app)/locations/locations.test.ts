import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";

const ctx: {
  user: { id: string; email: string; isSuperAdmin: boolean };
  organizationId: string;
  role: "MANAGER";
  actor: never;
  db: ReturnType<typeof forOrg>;
} = {
  user: { id: "", email: "", isSuperAdmin: false },
  organizationId: "",
  role: "MANAGER",
  actor: {} as never,
  db: {} as never,
};
vi.mock("@/lib/auth/context", () => ({
  requireRole: async () => ctx,
  requireOrg: async () => ctx,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("createLocation", () => {
  it("creates a location scoped to the active org", async () => {
    const org = await prisma.organization.create({ data: { name: "Loc", slug: `loc-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);
    const { createLocation } = await import("@/app/(app)/locations/actions");
    const fd = new FormData();
    fd.set("name", "Downtown Store");
    const res = await createLocation(fd);
    expect(res.error).toBeUndefined();
    expect(await prisma.location.count({ where: { organizationId: org.id, name: "Downtown Store" } })).toBe(1);
  });

  it("enforces the plan location cap", async () => {
    const org = await prisma.organization.create({ data: { name: "Cap", slug: `cap-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "TRIAL" } }); // maxLocations 1
    await prisma.location.create({ data: { organizationId: org.id, name: "Only" } });
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);
    const { createLocation } = await import("@/app/(app)/locations/actions");
    const fd = new FormData();
    fd.set("name", "Second");
    expect((await createLocation(fd)).error).toMatch(/plan allows 1 location/);
  });

  it("rejects a parentId from another organization and creates nothing", async () => {
    const other = await prisma.organization.create({ data: { name: "Other", slug: `other-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: other.id, planKey: "GROWTH" } });
    const foreignParent = await prisma.location.create({
      data: { organizationId: other.id, name: "Foreign HQ" },
    });

    const org = await prisma.organization.create({ data: { name: "Mine", slug: `mine-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);

    const { createLocation } = await import("@/app/(app)/locations/actions");
    const fd = new FormData();
    fd.set("name", "Child Store");
    fd.set("parentId", foreignParent.id);
    const res = await createLocation(fd);

    expect(res.error).toBeTruthy();
    expect(await prisma.location.count({ where: { organizationId: org.id } })).toBe(0);
  });
});
