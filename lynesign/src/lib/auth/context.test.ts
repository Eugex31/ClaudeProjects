import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/root";

const mockCookieStore = { get: vi.fn(), set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => mockCookieStore }));
const authState: { user: { id: string; email: string; isSuperAdmin: boolean } | null } = { user: null };
vi.mock("@/lib/auth/session", () => ({ getServerAuth: async () => (authState.user ? { user: authState.user } : null) }));

beforeEach(() => { mockCookieStore.get.mockReset(); authState.user = null; });

describe("auth context", () => {
  it("requireUser throws when signed out", async () => {
    const { requireUser } = await import("@/lib/auth/context");
    await expect(requireUser()).rejects.toThrow(/sign/i);
  });

  it("resolveActiveOrg rejects a cookie org the user is not a member of", async () => {
    const user = await prisma.user.create({ data: { email: `c-${Date.now()}@x.com` } });
    const mine = await prisma.organization.create({ data: { name: "Mine", slug: `mine-${Date.now()}` } });
    const other = await prisma.organization.create({ data: { name: "Other", slug: `other-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: mine.id, role: "OWNER" } });
    mockCookieStore.get.mockReturnValue({ value: other.id });
    authState.user = { id: user.id, email: user.email, isSuperAdmin: false };
    const { resolveActiveOrg } = await import("@/lib/auth/context");
    const res = await resolveActiveOrg(user.id);
    expect(res.organizationId).toBe(mine.id);
  });

  it("requireRole throws ForbiddenError for a VIEWER creating a screen", async () => {
    const user = await prisma.user.create({ data: { email: `v-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "V", slug: `v-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "VIEWER" } });
    mockCookieStore.get.mockReturnValue({ value: org.id });
    authState.user = { id: user.id, email: user.email, isSuperAdmin: false };
    const { requireRole } = await import("@/lib/auth/context");
    await expect(requireRole("screen.create")).rejects.toThrow(/permission/i);
  });
});
