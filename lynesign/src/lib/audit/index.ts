import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";

/**
 * One audit-log entry to record. `organizationId` is what decides the write
 * path: set it for a tenant action (member creates a location) and the row goes
 * through `withOrgTransaction`, so the tenant guard and Postgres RLS both apply;
 * omit it for a platform-level action (system boot, a cross-org job) and the row
 * is written unscoped with a null owner.
 */
export interface AuditInput {
  organizationId?: string;
  actorType: "USER" | "SCREEN" | "SYSTEM";
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  // Fields common to both paths. On the scoped path Layer 1 injects
  // `organizationId` inside the transaction, so it is deliberately absent here;
  // adding it would only have to match the bound org anyway.
  const entry = {
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
  };

  if (input.organizationId) {
    await withOrgTransaction(input.organizationId, (tx) => tx.auditLog.create({ data: entry }));
    return;
  }

  await prisma.auditLog.create({ data: { ...entry, organizationId: null } });
}
