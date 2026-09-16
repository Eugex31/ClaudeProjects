import { z } from "zod";
import type { Role } from "@prisma/client";
import { ASSIGNABLE_ROLES } from "@/lib/rbac/roles";

/**
 * Fields for inviting someone to an organization. `role` is constrained to the
 * roles a member may actually hand out (never OWNER), so a tampered form cannot
 * escalate.
 */
export const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  role: z.enum(ASSIGNABLE_ROLES as [Role, ...Role[]], {
    message: "Choose a role from the list.",
  }),
});

/**
 * Fields collected when a brand-new user accepts an invitation. Ignored when the
 * invited email already has an account.
 */
export const acceptInviteSchema = z.object({
  name: z.string().min(1, "Enter your name."),
  password: z.string().min(12, "Use at least 12 characters."),
});

export type InviteInput = z.infer<typeof inviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
