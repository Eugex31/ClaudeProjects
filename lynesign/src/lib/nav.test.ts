import { describe, it, expect } from "vitest";
import { Role } from "@prisma/client";

import { NAV_ITEMS, visibleNav } from "@/lib/nav";
import type { Actor } from "@/lib/rbac/can";

const actorWithRole = (role: Role): Actor => ({
  kind: "user",
  userId: "u",
  isSuperAdmin: false,
  role,
});

describe("visibleNav", () => {
  it("hides Billing from a VIEWER", () => {
    const actor = actorWithRole(Role.VIEWER);
    expect(visibleNav(actor).some((i) => i.href === "/billing")).toBe(false);
  });

  it("shows Billing to an OWNER", () => {
    const actor = actorWithRole(Role.OWNER);
    expect(visibleNav(actor).some((i) => i.href === "/billing")).toBe(true);
  });

  it("hides Users from a role without member.view but keeps it for OWNER", () => {
    // Every seeded role currently has member.view, so assert the mechanism via
    // an actor with no role at all: `can` returns false for gated items.
    const roleless: Actor = { kind: "user", userId: "u", isSuperAdmin: false, role: null };
    expect(visibleNav(roleless).some((i) => i.href === "/users")).toBe(false);
    expect(visibleNav(actorWithRole(Role.OWNER)).some((i) => i.href === "/users")).toBe(true);
  });

  it("always shows Dashboard first", () => {
    const actor = actorWithRole(Role.VIEWER);
    expect(visibleNav(actor)[0].href).toBe("/dashboard");
  });

  it("always shows the ungated later-increment sections", () => {
    const actor = actorWithRole(Role.VIEWER);
    const hrefs = visibleNav(actor).map((i) => i.href);
    for (const href of ["/media", "/playlists", "/campaigns", "/schedule", "/analytics", "/settings"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("hides Media from a roleless user", () => {
    const roleless: Actor = { kind: "user", userId: "u", isSuperAdmin: false, role: null };
    expect(visibleNav(roleless).some((i) => i.href === "/media")).toBe(false);
  });

  it("shows Media to a VIEWER", () => {
    const actor = actorWithRole(Role.VIEWER);
    expect(visibleNav(actor).some((i) => i.href === "/media")).toBe(true);
  });

  it("/schedule entry has action: schedule.view", () => {
    const item = NAV_ITEMS.find((i) => i.href === "/schedule");
    expect(item?.action).toBe("schedule.view");
  });

  it("/analytics entry has action: analytics.view", () => {
    const item = NAV_ITEMS.find((i) => i.href === "/analytics");
    expect(item?.action).toBe("analytics.view");
  });

  it("/canvas entry has action: canvas.view and appears after /playlists", () => {
    const canvasItem = NAV_ITEMS.find((i) => i.href === "/canvas");
    const playlistsItem = NAV_ITEMS.find((i) => i.href === "/playlists");
    expect(canvasItem?.action).toBe("canvas.view");
    expect(canvasItem).toBeDefined();
    expect(playlistsItem).toBeDefined();
    const canvasIndex = NAV_ITEMS.findIndex((i) => i.href === "/canvas");
    const playlistsIndex = NAV_ITEMS.findIndex((i) => i.href === "/playlists");
    expect(canvasIndex).toBeGreaterThan(playlistsIndex);
  });

  it("NAV_ITEMS lists every section once, Dashboard first, Settings last", () => {
    expect(NAV_ITEMS[0].href).toBe("/dashboard");
    expect(NAV_ITEMS[NAV_ITEMS.length - 1].href).toBe("/settings");
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
  });
});
