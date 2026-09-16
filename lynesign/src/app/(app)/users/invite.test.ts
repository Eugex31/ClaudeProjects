import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";

const ctx = { user: { id: "", email: "", isSuperAdmin: false }, organizationId: "", role: "OWNER" as const, actor: {} as never, db: {} as never };
vi.mock("@/lib/auth/context", () => ({ requireRole: async () => ctx, requireOrg: async () => ctx }));
vi.mock("@/lib/email", () => ({ queueMail: vi.fn(), sendMail: vi.fn(), invitationEmail: () => "<p>x</p>" }));

/** Point the mocked context at a real org, with a real tenant facade for ctx.db. */
function useOrg(orgId: string, ownerId: string, ownerEmail: string) {
  ctx.user = { id: ownerId, email: ownerEmail, isSuperAdmin: false };
  ctx.organizationId = orgId;
  ctx.db = forOrg(orgId) as unknown as never;
}

describe("inviteMember", () => {
  it("creates a pending invitation for a new email", async () => {
    const owner = await prisma.user.create({ data: { email: `own-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Inv", slug: `inv-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    useOrg(org.id, owner.id, owner.email);

    const { inviteMember } = await import("@/app/(app)/users/actions");
    const fd = new FormData(); fd.set("email", `newbie-${Date.now()}@x.com`); fd.set("role", "MANAGER");
    const res = await inviteMember(fd);
    expect(res.ok).toBe(true);
    expect(await prisma.invitation.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("rejects re-inviting someone who is already a member without throwing", async () => {
    const owner = await prisma.user.create({ data: { email: `own2-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Inv2", slug: `inv2-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });

    const member = await prisma.user.create({ data: { email: `mem-${Date.now()}@x.com` } });
    await prisma.membership.create({ data: { userId: member.id, organizationId: org.id, role: "VIEWER" } });

    useOrg(org.id, owner.id, owner.email);

    const { inviteMember } = await import("@/app/(app)/users/actions");
    const fd = new FormData(); fd.set("email", member.email); fd.set("role", "MANAGER");
    const res = await inviteMember(fd);
    expect(res.error).toBe("That person is already a member of this organization.");
    expect(res.ok).toBeUndefined();
    expect(await prisma.invitation.count({ where: { organizationId: org.id } })).toBe(0);
  });

  // An open invitation is a promised seat. Counting only ACTIVE memberships let
  // an org at its cap issue unlimited further invitations, each of which then
  // became a member on accept.
  it("counts open invitations against the seat ceiling", async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    const owner = await prisma.user.create({ data: { email: `own3-${stamp}@x.com` } });
    // TRIAL allows 3 team members.
    const org = await prisma.organization.create({ data: { name: "Cap", slug: `cap-${stamp}` } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "TRIAL" } });
    useOrg(org.id, owner.id, owner.email);

    const { inviteMember } = await import("@/app/(app)/users/actions");
    for (const n of [1, 2]) {
      const fd = new FormData(); fd.set("email", `cap${n}-${stamp}@x.com`); fd.set("role", "VIEWER");
      expect((await inviteMember(fd)).ok).toBe(true);
    }

    // 1 member + 2 open invitations = 3 seats, which is the whole plan.
    const fd = new FormData(); fd.set("email", `cap3-${stamp}@x.com`); fd.set("role", "VIEWER");
    await expect(inviteMember(fd)).rejects.toThrow(/3 team members/);
    expect(await prisma.invitation.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("still refreshes an invitation that is already holding a seat", async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    const owner = await prisma.user.create({ data: { email: `own4-${stamp}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Cap2", slug: `cap2-${stamp}` } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "TRIAL" } });
    useOrg(org.id, owner.id, owner.email);

    const { inviteMember } = await import("@/app/(app)/users/actions");
    const invitee = `refresh-${stamp}@x.com`;
    for (const n of [1, 2]) {
      const fd = new FormData(); fd.set("email", n === 1 ? invitee : `other-${stamp}@x.com`); fd.set("role", "VIEWER");
      expect((await inviteMember(fd)).ok).toBe(true);
    }

    // The org is now at its ceiling, but re-inviting an existing open invite
    // consumes no new seat, so it must still succeed and rotate the token.
    const before = await prisma.invitation.findFirstOrThrow({ where: { organizationId: org.id, email: invitee } });
    const fd = new FormData(); fd.set("email", invitee); fd.set("role", "MANAGER");
    expect((await inviteMember(fd)).ok).toBe(true);
    const after = await prisma.invitation.findFirstOrThrow({ where: { organizationId: org.id, email: invitee } });
    expect(after.id).toBe(before.id);
    expect(after.token).not.toBe(before.token);
    expect(after.role).toBe("MANAGER");
    expect(await prisma.invitation.count({ where: { organizationId: org.id } })).toBe(2);
  });
});
