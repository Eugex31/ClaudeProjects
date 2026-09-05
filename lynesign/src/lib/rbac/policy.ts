import { Role } from "@prisma/client";

export type Action =
  | "org.view" | "org.update" | "org.delete"
  | "member.view" | "member.invite" | "member.updateRole" | "member.remove"
  | "location.view" | "location.create" | "location.update" | "location.delete"
  | "screen.view" | "screen.create" | "screen.update" | "screen.delete" | "screen.pair"
  | "billing.view" | "billing.manage"
  | "audit.view"
  | "player.sync"
  | "media.view" | "media.create" | "media.update" | "media.delete" | "media.folder.manage"
  | "playlist.view" | "playlist.create" | "playlist.update" | "playlist.delete" | "playlist.assign"
  | "canvas.view" | "canvas.create" | "canvas.update" | "canvas.delete"
  | "campaign.view" | "campaign.create" | "campaign.update" | "campaign.delete"
  | "schedule.view" | "schedule.create" | "schedule.update" | "schedule.delete" | "schedule.assign"
  | "analytics.view";

const ALL: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER, Role.CONTENT_MANAGER, Role.VIEWER];
const MANAGERS_UP: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];
const CONTENT_UP: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER, Role.CONTENT_MANAGER];
const ADMINS_UP: Role[] = [Role.OWNER, Role.ADMIN];

export const POLICY: Record<Action, Role[]> = {
  "org.view": ALL,
  "org.update": ADMINS_UP,
  "org.delete": [Role.OWNER],
  "member.view": ALL,
  "member.invite": ADMINS_UP,
  "member.updateRole": ADMINS_UP,
  "member.remove": ADMINS_UP,
  "location.view": ALL,
  "location.create": MANAGERS_UP,
  "location.update": MANAGERS_UP,
  "location.delete": ADMINS_UP,
  "screen.view": ALL,
  "screen.create": CONTENT_UP,
  "screen.update": CONTENT_UP,
  "screen.delete": MANAGERS_UP,
  "screen.pair": CONTENT_UP,
  "billing.view": ADMINS_UP,
  "billing.manage": [Role.OWNER],
  "audit.view": ADMINS_UP,
  "player.sync": [],
  "media.view": ALL,
  "media.create": CONTENT_UP,
  "media.update": CONTENT_UP,
  "media.delete": MANAGERS_UP,
  "media.folder.manage": CONTENT_UP,
  "playlist.view": ALL,
  "playlist.create": CONTENT_UP,
  "playlist.update": CONTENT_UP,
  "playlist.delete": MANAGERS_UP,
  "playlist.assign": MANAGERS_UP,
  "canvas.view": ALL,
  "canvas.create": CONTENT_UP,
  "canvas.update": CONTENT_UP,
  "canvas.delete": CONTENT_UP,
  "campaign.view": ALL,
  "campaign.create": MANAGERS_UP,
  "campaign.update": MANAGERS_UP,
  "campaign.delete": MANAGERS_UP,
  "schedule.view": ALL,
  "schedule.create": MANAGERS_UP,
  "schedule.update": MANAGERS_UP,
  "schedule.delete": MANAGERS_UP,
  "schedule.assign": MANAGERS_UP,
  "analytics.view": ALL,
};
