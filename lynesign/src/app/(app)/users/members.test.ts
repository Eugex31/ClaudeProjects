import { describe, it, expect, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";

const ctx: {
  user: { id: string; email: string; isSuperAdmin: boolean };
  organizationId: string;
  role: Role;
  actor: { kind: "user"; userId: string; isSuperAdmin: boolean; role: Role };
  db: ReturnType<typeof forOrg>;
} = {
  user: { id: "", email: "", isSuperAdmin: false },
  organizationId: "",
  role: "OWNER",
  actor: { kind: "user", userId: "", isSuperAdmin: false, role: "OWNER" },
  db: {} as never,
};

vi.mock("@/lib/auth/context", () => ({
  requireRole: async () => ctx,
  requireOrg: async () => ctx,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedOrg(prefix: string) {
  const owner = await prisma.user.create({ data: { email: `${uid(prefix)}@x.com` } });
  const org = await prisma.organization.create({ data: { name: prefix, slug: uid(prefix) } });
  const ownerMembership = await prisma.membership.create({
    data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
  });
  ctx.user = { id: owner.id, email: owner.email, isSuperAdmin: false };
  ctx.organizationId = org.id;
  ctx.role = "OWNER";
  ctx.actor = { kind: "user", userId: owner.id, isSuperAdmin: false, role: "OWNER" };
  ctx.db = forOrg(org.id);
  return { owner, org, ownerMembership };
}

async function addMember(orgId: string, role: Role) {
  const user = await prisma.user.create({ data: { email: `${uid("mem")}@x.com` } });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: orgId, role },
  });
  return { user, membership };
}

describe("member management", () => {
  it("will not demote the last owner", async () => {
    const { ownerMembership } = await seedOrg("lastowner");
    const { updateMemberRole } = await import("@/app/(app)/users/actions");
    const res = await updateMemberRole(ownerMembership.id, "ADMIN");
    expect(res.error).toMatch(/at least one owner/);
    const row = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
    expect(row?.role).toBe("OWNER");
  });

  it("will not let a non-owner actor grant the owner role", async () => {
    const { org } = await seedOrg("noescalate");
    const { membership } = await addMember(org.id, "VIEWER");
    // Caller is an ADMIN, not an OWNER and not a super admin.
    ctx.role = "ADMIN";
    ctx.actor = { kind: "user", userId: ctx.user.id, isSuperAdmin: false, role: "ADMIN" };

    const { updateMemberRole } = await import("@/app/(app)/users/actions");
    const res = await updateMemberRole(membership.id, "OWNER");
    expect(res.error).toMatch(/owner can grant the owner role/i);
    const row = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(row?.role).toBe("VIEWER");
  });

  it("will not let you remove yourself", async () => {
    const { ownerMembership } = await seedOrg("noself");
    const { removeMember } = await import("@/app/(app)/users/actions");
    const res = await removeMember(ownerMembership.id);
    expect(res.error).toMatch(/cannot remove yourself/i);
    const row = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
    expect(row).not.toBeNull();
  });

  it("changes a member's role when the actor is an owner", async () => {
    const { org } = await seedOrg("promote");
    const { membership } = await addMember(org.id, "VIEWER");
    const { updateMemberRole } = await import("@/app/(app)/users/actions");
    const res = await updateMemberRole(membership.id, "MANAGER");
    expect(res.error).toBeUndefined();
    const row = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(row?.role).toBe("MANAGER");
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "member.updateRole" },
    });
    expect(audit?.metadata).toMatchObject({ from: "VIEWER", to: "MANAGER" });
  });

  it("removes another member and keeps a cross-org id from resolving", async () => {
    const { org } = await seedOrg("remove");
    const { membership } = await addMember(org.id, "VIEWER");

    // A membership in a different org must be invisible through the facade.
    const otherOrg = await prisma.organization.create({
      data: { name: "other", slug: uid("other") },
    });
    const otherUser = await prisma.user.create({ data: { email: `${uid("other")}@x.com` } });
    const foreign = await prisma.membership.create({
      data: { userId: otherUser.id, organizationId: otherOrg.id, role: "ADMIN" },
    });

    const { removeMember } = await import("@/app/(app)/users/actions");

    const foreignRes = await removeMember(foreign.id);
    expect(foreignRes.error).toMatch(/not found/i);
    expect(await prisma.membership.findUnique({ where: { id: foreign.id } })).not.toBeNull();

    const res = await removeMember(membership.id);
    expect(res.error).toBeUndefined();
    expect(await prisma.membership.findUnique({ where: { id: membership.id } })).toBeNull();
  });
});
