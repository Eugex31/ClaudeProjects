import { describe, it, expect } from "vitest";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/root";

describe("writeAudit", () => {
  it("persists an org-scoped entry", async () => {
    const org = await prisma.organization.create({ data: { name: "Aud", slug: `aud-${Date.now()}` } });
    await writeAudit({ organizationId: org.id, actorType: "USER", actorId: "u1", action: "location.create", targetType: "Location", targetId: "loc1" });
    const rows = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("location.create");
  });

  it("writes an unscoped entry with a null organizationId", async () => {
    const action = `system.boot.${Date.now()}`;
    await writeAudit({ actorType: "SYSTEM", action, targetType: "Process" });
    const rows = await prisma.auditLog.findMany({ where: { action } });
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBeNull();
    expect(rows[0].metadata).toEqual({});
  });
});
