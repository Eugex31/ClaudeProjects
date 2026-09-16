import { prisma } from "@/lib/prisma";

export type AdminAction =
  | "SUSPEND"
  | "REACTIVATE"
  | "CANCEL_SUBSCRIPTION"
  | "DELETE"
  | "NOTIFY"
  | "ASSIGN_PLAN";

// Deliberately fire-and-forget from the caller's perspective in spirit (the
// action itself already succeeded by the time this is called) but awaited
// here so a logging failure surfaces in the route's existing catch-all
// error handler rather than failing silently.
export async function logAdminAction(input: {
  adminEmail: string;
  targetUserId: string;
  targetEmail: string;
  targetName?: string | null;
  action: AdminAction;
  details?: string;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminEmail: input.adminEmail,
      targetUserId: input.targetUserId,
      targetEmail: input.targetEmail,
      targetName: input.targetName ?? null,
      action: input.action,
      details: input.details,
    },
  });
}
