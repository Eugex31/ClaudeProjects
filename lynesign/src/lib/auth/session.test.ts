import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { createCredentialsSession, SESSION_COOKIE } from "@/lib/auth/session";

describe("createCredentialsSession", () => {
  it("creates a Session row that expires in the future", async () => {
    const user = await prisma.user.create({ data: { email: `s-${Date.now()}@x.com` } });
    const token = await createCredentialsSession(user.id);
    const row = await prisma.session.findUnique({ where: { sessionToken: token } });
    expect(row?.userId).toBe(user.id);
    expect(row!.expires.getTime()).toBeGreaterThan(Date.now());
  });

  it("expires roughly 30 days out and issues a distinct token each call", async () => {
    const user = await prisma.user.create({ data: { email: `s2-${Date.now()}@x.com` } });
    const t1 = await createCredentialsSession(user.id);
    const t2 = await createCredentialsSession(user.id);
    expect(t1).not.toBe(t2);
    const row = await prisma.session.findUnique({ where: { sessionToken: t1 } });
    const daysOut = (row!.expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysOut).toBeGreaterThan(29);
    expect(daysOut).toBeLessThan(31);
  });
});

describe("SESSION_COOKIE", () => {
  it("matches the Auth.js cookie name for the deployment scheme", () => {
    // The name tracks the AUTH_URL scheme, the same signal @auth/core uses
    // (`url.protocol === "https:"`). The test env's AUTH_URL is http://, so the
    // non-secure name applies -- the same one `auth()` would then read.
    expect(SESSION_COOKIE).toBe("authjs.session-token");
  });
});
