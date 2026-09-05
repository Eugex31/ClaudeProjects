import { Role } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";
import { POLICY, type Action } from "./policy";

export type Actor =
  | { kind: "user"; userId: string; isSuperAdmin: boolean; role: Role | null }
  | { kind: "screen"; screenId: string; organizationId: string };

const SCREEN_ACTIONS = new Set<Action>(["player.sync"]);

export function can(actor: Actor, action: Action): boolean {
  if (actor.kind === "screen") return SCREEN_ACTIONS.has(action);
  if (actor.isSuperAdmin) return true;
  if (!actor.role) return false;
  return POLICY[action]?.includes(actor.role) ?? false;
}

export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) {
    throw new ForbiddenError("You do not have permission to do that.");
  }
}
