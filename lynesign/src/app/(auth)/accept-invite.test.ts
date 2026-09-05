import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/root";
import { hashPassword } from "@/lib/auth/password";

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, get: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** An org on `planKey` with one OWNER, who is also the inviter. Returns both. */
async function orgOnPlan(planKey: "TRIAL" | "GROWTH", stamp: string) {
  const org = await prisma.organization.create({ data: { name: "Acc", slug: `acc-${stamp}` } });
  await prisma.subscription.create({ data: { organizationId: org.id, planKey } });
  const owner = await prisma.user.create({ data: { email: `acc-own-${stamp}@x.com` } });
  await prisma.membership.create({
    data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
  });
  return { org, owner };
}

async function inviteFor(organizationId: string, invitedByUserId: string, email: string) {
  return prisma.invitation.create({
    data: {
      organizationId,
      email,
      role: "VIEWER",
      token: randomUUID(),
      expiresAt: new Date(Date.now() + WEEK_MS),
      invitedByUserId,
    },
  });
}

describe("acceptInvite", () => {
  // The seat ceiling is checked when the invitation is issued, but the org can
  // fill up between issue and accept. Without a re-check the accept sails past
  // the plan limit.
  it("refuses to create a membership when the org is over its seat ceiling", async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    // TRIAL allows 3 team members; the owner already holds one seat.
    const { org, owner } = await orgOnPlan("TRIAL", stamp);

    // The remaining seats fill with ACTIVE memberships after the invite is sent.
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({ data: { email: `seat${i}-${stamp}@x.com` } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org.id, role: "VIEWER" } });
    }

    const email = `late-${stamp}@x.com`;
    const invited = await prisma.user.create({
      data: { email, hashedPassword: await hashPassword("correcthorsebattery") },
    });
    const invitation = await inviteFor(org.id, owner.id, email);

    const { acceptInvite } = await import("@/app/(auth)/actions");
    const res = await acceptInvite(invitation.token, new FormData());

    expect(res.error).toMatch(/member limit/);
    expect(
      await prisma.membership.count({ where: { organizationId: org.id, userId: invited.id } }),
    ).toBe(0);
    expect(await prisma.membership.count({ where: { organizationId: org.id } })).toBe(3);
    // The invitation is left open, so it still works once a seat frees up.
    const after = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(after.acceptedAt).toBeNull();
    expect(await prisma.session.count({ where: { userId: invited.id } })).toBe(0);
  });

  it("accepts within the ceiling and mints a session", async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    const { org, owner } = await orgOnPlan("GROWTH", stamp);
    const email = `ok-${stamp}@x.com`;
    const invited = await prisma.user.create({
      data: { email, hashedPassword: await hashPassword("correcthorsebattery") },
    });
    const invitation = await inviteFor(org.id, owner.id, email);

    const { acceptInvite } = await import("@/app/(auth)/actions");
    await expect(acceptInvite(invitation.token, new FormData())).rejects.toThrow(
      "REDIRECT:/dashboard",
    );

    expect(
      await prisma.membership.count({ where: { organizationId: org.id, userId: invited.id } }),
    ).toBe(1);
    expect(await prisma.session.count({ where: { userId: invited.id } })).toBe(1);
  });

  // signInWithPassword bounces a flagged account to the forced-reset flow. The
  // invitation route must not be a way around that.
  it("does not mint a session for a mustResetPassword account", async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    const { org, owner } = await orgOnPlan("GROWTH", stamp);
    const email = `forced-${stamp}@x.com`;
    const invited = await prisma.user.create({
      data: {
        email,
        hashedPassword: await hashPassword("correcthorsebattery"),
        mustResetPassword: true,
      },
    });
    const invitation = await inviteFor(org.id, owner.id, email);

    cookieSet.mockClear();
    const { acceptInvite } = await import("@/app/(auth)/actions");
    await expect(acceptInvite(invitation.token, new FormData())).rejects.toThrow(
      "REDIRECT:/forgot-password?forced=1",
    );

    // They are a member -- they just cannot log in until they reset.
    expect(
      await prisma.membership.count({ where: { organizationId: org.id, userId: invited.id } }),
    ).toBe(1);
    expect(await prisma.session.count({ where: { userId: invited.id } })).toBe(0);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
