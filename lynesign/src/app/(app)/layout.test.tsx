import { describe, it, expect, vi, beforeEach } from "vitest";

import { UnauthorizedError, NotFoundError } from "@/lib/errors";

const requireOrgMock = vi.fn();
vi.mock("@/lib/auth/context", () => ({ requireOrg: () => requireOrgMock() }));

const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// The happy path loads the org list; keep prisma from touching a real database.
vi.mock("@/lib/db/root", () => ({
  prisma: { membership: { findMany: vi.fn(async () => []) } },
}));

async function renderLayout() {
  const mod = await import("@/app/(app)/layout");
  return mod.default({ children: null } as never);
}

describe("(app) layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when the request is unauthorized", async () => {
    requireOrgMock.mockRejectedValueOnce(new UnauthorizedError("Please sign in."));
    await expect(renderLayout()).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /register?onboard=1 when the user has no membership", async () => {
    requireOrgMock.mockRejectedValueOnce(new NotFoundError("No org yet."));
    await expect(renderLayout()).rejects.toThrow("REDIRECT:/register?onboard=1");
  });

  it("rethrows an unexpected error rather than redirecting", async () => {
    requireOrgMock.mockRejectedValueOnce(new Error("boom"));
    await expect(renderLayout()).rejects.toThrow("boom");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
