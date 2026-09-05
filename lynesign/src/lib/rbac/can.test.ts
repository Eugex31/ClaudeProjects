import { describe, it, expect } from "vitest";
import { can, assertCan } from "@/lib/rbac/can";
import { Role } from "@prisma/client";

const user = (role: Role | null, isSuperAdmin = false) =>
  ({ kind: "user", userId: "u", isSuperAdmin, role }) as const;

describe("can", () => {
  it("OWNER can invite members", () => {
    expect(can(user(Role.OWNER), "member.invite")).toBe(true);
  });
  it("VIEWER cannot create a screen", () => {
    expect(can(user(Role.VIEWER), "screen.create")).toBe(false);
  });
  it("CONTENT_MANAGER can create a screen but not manage billing", () => {
    expect(can(user(Role.CONTENT_MANAGER), "screen.create")).toBe(true);
    expect(can(user(Role.CONTENT_MANAGER), "billing.manage")).toBe(false);
  });
  it("super admin bypasses the table", () => {
    expect(can(user(null, true), "org.delete")).toBe(true);
  });
  it("a screen principal can only sync itself", () => {
    expect(can({ kind: "screen", screenId: "s", organizationId: "o" }, "player.sync")).toBe(true);
    expect(can({ kind: "screen", screenId: "s", organizationId: "o" }, "screen.create")).toBe(false);
  });
  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan(user(Role.VIEWER), "screen.create")).toThrow(/permission/i);
  });
  it("CONTENT_MANAGER can create media but not delete", () => {
    expect(can(user(Role.CONTENT_MANAGER), "media.create")).toBe(true);
    expect(can(user(Role.CONTENT_MANAGER), "media.delete")).toBe(false);
  });
  it("VIEWER can view media only", () => {
    expect(can(user(Role.VIEWER), "media.view")).toBe(true);
    expect(can(user(Role.VIEWER), "media.create")).toBe(false);
  });
  it("playlist permissions by role", () => {
    const contentMgr = user(Role.CONTENT_MANAGER);
    const manager = user(Role.MANAGER);
    const viewer = user(Role.VIEWER);
    expect(can(viewer, "playlist.view")).toBe(true);
    expect(can(contentMgr, "playlist.update")).toBe(true);
    expect(can(viewer, "playlist.update")).toBe(false);
    expect(can(contentMgr, "playlist.create")).toBe(true);
    expect(can(contentMgr, "playlist.delete")).toBe(false);
    expect(can(contentMgr, "playlist.assign")).toBe(false);
    expect(can(manager, "playlist.delete")).toBe(true);
    expect(can(manager, "playlist.assign")).toBe(true);
  });
  it("campaign permissions by role", () => {
    expect(can(user(Role.VIEWER), "campaign.view")).toBe(true);
    expect(can(user(Role.CONTENT_MANAGER), "campaign.view")).toBe(true);
    expect(can(user(Role.CONTENT_MANAGER), "campaign.create")).toBe(false);
    expect(can(user(Role.MANAGER), "campaign.create")).toBe(true);
    expect(can(user(Role.MANAGER), "campaign.update")).toBe(true);
    expect(can(user(Role.MANAGER), "campaign.delete")).toBe(true);
  });
  it("canvas permissions by role", () => {
    const contentMgr = user(Role.CONTENT_MANAGER);
    const manager = user(Role.MANAGER);
    const viewer = user(Role.VIEWER);
    expect(can(viewer, "canvas.view")).toBe(true);
    expect(can(contentMgr, "canvas.view")).toBe(true);
    expect(can(contentMgr, "canvas.create")).toBe(true);
    expect(can(contentMgr, "canvas.update")).toBe(true);
    expect(can(contentMgr, "canvas.delete")).toBe(true);
    expect(can(viewer, "canvas.create")).toBe(false);
    expect(can(viewer, "canvas.update")).toBe(false);
    expect(can(viewer, "canvas.delete")).toBe(false);
    expect(can(manager, "canvas.create")).toBe(true);
    expect(can(manager, "canvas.update")).toBe(true);
    expect(can(manager, "canvas.delete")).toBe(true);
  });
});
