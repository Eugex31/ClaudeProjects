import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/root";

const cookieStore = { set: vi.fn(), get: vi.fn() };
const redirectMock = vi.fn(() => { throw new Error("REDIRECT"); });
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
const authUser = { id: "", email: "x", isSuperAdmin: false };
vi.mock("@/lib/auth/context", () => ({ requireUser: async () => authUser, ACTIVE_ORG_COOKIE: "lynesign_active_org" }));

describe("switchOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an org the user does not belong to", async () => {
    const u = await prisma.user.create({ data: { email: `sw-${Date.now()}@x.com` } });
    const other = await prisma.organization.create({ data: { name: "No", slug: `no-${Date.now()}` } });
    authUser.id = u.id;
    const { switchOrg } = await import("@/app/(app)/settings/actions");
    expect((await switchOrg(other.id)).error).toMatch(/not a member/);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a suspended membership", async () => {
    const u = await prisma.user.create({ data: { email: `sw-susp-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Suspended", slug: `susp-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: org.id, role: "ADMIN", status: "SUSPENDED" } });
    authUser.id = u.id;
    const { switchOrg } = await import("@/app/(app)/settings/actions");
    expect((await switchOrg(org.id)).error).toMatch(/not a member/);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("sets the cookie for a valid org", async () => {
    const u = await prisma.user.create({ data: { email: `sw2-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Yes", slug: `yes-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: org.id, role: "ADMIN" } });
    authUser.id = u.id;
    const { switchOrg } = await import("@/app/(app)/settings/actions");
    await expect(switchOrg(org.id)).rejects.toThrow("REDIRECT");
    expect(cookieStore.set).toHaveBeenCalledWith("lynesign_active_org", org.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  });
});
