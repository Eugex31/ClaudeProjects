import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
const redirectMock = vi.fn(() => {
  throw new Error("REDIRECT");
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("signUp", () => {
  it("creates user, org, owner membership, and a trial subscription", async () => {
    const { signUp } = await import("@/app/(auth)/actions");
    // Filter by the unique email, not the name: another test file deletes all
    // organizations (cascading memberships), which would leave a stale
    // name-matched user with no membership on repeat runs.
    const email = `dana-${Date.now()}@x.com`;
    const fd = new FormData();
    fd.set("name", "Dana");
    fd.set("email", email);
    fd.set("password", "correcthorsebattery");
    fd.set("organizationName", "Dana Signs");
    await expect(signUp(fd)).rejects.toThrow("REDIRECT");

    const user = await prisma.user.findFirst({
      where: { email },
      include: {
        memberships: { include: { organization: { include: { subscription: true } } } },
      },
    });
    expect(user?.memberships[0].role).toBe("OWNER");
    expect(user?.memberships[0].organization.subscription?.planKey).toBe("TRIAL");
  });

  it("rejects a duplicate email without throwing", async () => {
    const { signUp } = await import("@/app/(auth)/actions");
    const email = `dup-${Date.now()}@x.com`;
    const a = new FormData();
    a.set("name", "A");
    a.set("email", email);
    a.set("password", "correcthorsebattery");
    a.set("organizationName", "A");
    await expect(signUp(a)).rejects.toThrow("REDIRECT");
    const b = new FormData();
    b.set("name", "B");
    b.set("email", email);
    b.set("password", "correcthorsebattery");
    b.set("organizationName", "B");
    const res = await signUp(b);
    expect(res.error).toMatch(/already exists/);
  });
});
