import { describe, it, expect } from "vitest";
import { can } from "@/lib/rbac/can";
import { Role } from "@prisma/client";

const user = (role: Role | null, isSuperAdmin = false) =>
  ({ kind: "user", userId: "u", isSuperAdmin, role }) as const;

describe("schedule permissions by role", () => {
  it("VIEWER can view schedule only", () => {
    expect(can(user(Role.VIEWER), "schedule.view")).toBe(true);
    expect(can(user(Role.VIEWER), "schedule.create")).toBe(false);
  });
  it("CONTENT_MANAGER can view schedule but not create", () => {
    expect(can(user(Role.CONTENT_MANAGER), "schedule.view")).toBe(true);
    expect(can(user(Role.CONTENT_MANAGER), "schedule.create")).toBe(false);
  });
  it("MANAGER can create, update, delete, and assign schedule", () => {
    expect(can(user(Role.MANAGER), "schedule.create")).toBe(true);
    expect(can(user(Role.MANAGER), "schedule.update")).toBe(true);
    expect(can(user(Role.MANAGER), "schedule.delete")).toBe(true);
    expect(can(user(Role.MANAGER), "schedule.assign")).toBe(true);
  });
  it("ADMIN can create, update, delete, and assign schedule", () => {
    expect(can(user(Role.ADMIN), "schedule.create")).toBe(true);
    expect(can(user(Role.ADMIN), "schedule.update")).toBe(true);
    expect(can(user(Role.ADMIN), "schedule.delete")).toBe(true);
    expect(can(user(Role.ADMIN), "schedule.assign")).toBe(true);
  });
  it("OWNER can create, update, delete, and assign schedule", () => {
    expect(can(user(Role.OWNER), "schedule.create")).toBe(true);
    expect(can(user(Role.OWNER), "schedule.update")).toBe(true);
    expect(can(user(Role.OWNER), "schedule.delete")).toBe(true);
    expect(can(user(Role.OWNER), "schedule.assign")).toBe(true);
  });
});

describe("analytics permissions by role", () => {
  it("VIEWER can view analytics", () => {
    expect(can(user(Role.VIEWER), "analytics.view")).toBe(true);
  });
  it("CONTENT_MANAGER can view analytics", () => {
    expect(can(user(Role.CONTENT_MANAGER), "analytics.view")).toBe(true);
  });
  it("MANAGER can view analytics", () => {
    expect(can(user(Role.MANAGER), "analytics.view")).toBe(true);
  });
  it("ADMIN can view analytics", () => {
    expect(can(user(Role.ADMIN), "analytics.view")).toBe(true);
  });
  it("OWNER can view analytics", () => {
    expect(can(user(Role.OWNER), "analytics.view")).toBe(true);
  });
});
