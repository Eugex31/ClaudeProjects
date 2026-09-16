/**
 * The authenticated app's primary navigation, defined once and shared by the
 * desktop sidebar and the mobile drawer.
 *
 * `icon` is a string key, not a component, so this module stays free of any
 * `lucide-react` import and can be consumed by server code, the RBAC filter,
 * and tests alike. `nav-sidebar.tsx` maps the key to a real icon.
 *
 * `action` names the RBAC permission a role must hold for the item to appear.
 * Items without an `action` are always visible. Hiding an item is a convenience
 * only: every route still gates itself on the server.
 */

import { can, type Actor } from "@/lib/rbac/can";
import type { Action } from "@/lib/rbac/policy";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  action?: Action;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/screens", label: "Screens", icon: "screens", action: "screen.view" },
  { href: "/locations", label: "Locations", icon: "locations", action: "location.view" },
  { href: "/media", label: "Media", icon: "media", action: "media.view" },
  { href: "/playlists", label: "Playlists", icon: "playlists", action: "playlist.view" },
  { href: "/canvas", label: "Canvas", icon: "canvas", action: "canvas.view" },
  { href: "/campaigns", label: "Campaigns", icon: "campaigns", action: "campaign.view" },
  { href: "/schedule", label: "Schedule", icon: "schedule", action: "schedule.view" },
  { href: "/analytics", label: "Analytics", icon: "analytics", action: "analytics.view" },
  { href: "/users", label: "Users", icon: "users", action: "member.view" },
  { href: "/billing", label: "Billing", icon: "billing", action: "billing.view" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

/**
 * The nav items the given actor may see: every ungated item, plus each gated
 * item whose `action` the actor is allowed to perform.
 */
export function visibleNav(actor: Actor): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.action || can(actor, item.action));
}
