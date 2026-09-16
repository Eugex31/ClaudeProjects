import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import { TENANT_TABLES } from "./tenant-tables";

const prisma = new PrismaClient();

/** Every table carrying organizationId — must match the migration's ARRAY. */
export { TENANT_TABLES };

/** Global tables that must NOT have RLS. */
const GLOBAL_TABLES: string[] = [
  "Organization", "User", "Plan", "Account", "Session", "VerificationToken",
];

const SET_ORG = `SELECT set_config($1, $2, true)`;

describe("row-level security", () => {
  beforeAll(async () => {
    // Clearing organizations is enough: every tenant table cascades from it.
    // Deleting Location directly is not -- Screen.location is onDelete: Restrict,
    // so any screen left behind by another test file would block it.
    await prisma.$executeRawUnsafe(`DELETE FROM "Organization"`);
  });

  it("hides rows from other orgs when app.current_org is set", async () => {
    const orgA = await prisma.organization.create({ data: { name: "A", slug: `a-${Date.now()}` } });
    const orgB = await prisma.organization.create({ data: { name: "B", slug: `b-${Date.now()}` } });
    await prisma.location.create({ data: { organizationId: orgA.id, name: "A-loc" } });
    await prisma.location.create({ data: { organizationId: orgB.id, name: "B-loc" } });

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_ORG, "app.current_org", orgA.id);
      return tx.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "Location"`);
    });
    expect(rows.map((r) => r.name)).toEqual(["A-loc"]);
  });

  it("rejects cross-org writes (WITH CHECK) and allows in-org writes", async () => {
    const orgA = await prisma.organization.create({ data: { name: "A", slug: `wa-${Date.now()}` } });
    const orgB = await prisma.organization.create({ data: { name: "B", slug: `wb-${Date.now()}` } });

    // INSERT for another org while scoped to orgA -> Postgres rejects it
    // ("new row violates row-level security policy") via the policy's WITH CHECK.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(SET_ORG, "app.current_org", orgA.id);
        await tx.location.create({ data: { organizationId: orgB.id, name: "cross-org" } });
      }),
    ).rejects.toThrow(/row-level security/i);

    // INSERT for the scoped org is accepted by WITH CHECK, is visible under the
    // policy inside that same scoped transaction, and survives COMMIT.
    //
    // The last part looks like it fails unless the policy treats an empty
    // `app.current_org` as "no context": Postgres restores a custom GUC to '',
    // never back to NULL, so a reader reusing that connection would otherwise be
    // blind to every row. See migration 20260830032500_rls_empty_guc_is_unscoped.
    const okName = `in-org-${Date.now()}`;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_ORG, "app.current_org", orgA.id);
      const created = await tx.location.create({
        data: { organizationId: orgA.id, name: okName },
      });
      const visible = await tx.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM "Location"`,
      );
      return { created, visible };
    });
    expect(result.created.organizationId).toBe(orgA.id);
    expect(result.visible.map((r) => r.name)).toEqual([okName]);
    expect(await prisma.location.count({ where: { name: okName } })).toBe(1);
  });

  it("enables + forces RLS with a tenant_isolation policy on every tenant table", async () => {
    const rows = await prisma.$queryRawUnsafe<
      {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        hasPolicy: boolean;
      }[]
    >(`
      SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public'
                 AND p.tablename = c.relname
                 AND p.policyname = 'tenant_isolation'
             ) AS "hasPolicy"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    const byName = new Map(rows.map((r) => [r.relname, r]));

    // Every tenant table: RLS enabled, forced, and has the tenant_isolation policy.
    // Filtering to a set means a missing/misconfigured table names itself.
    const tenantMisconfigured = TENANT_TABLES.filter((t) => {
      const r = byName.get(t);
      return !r || !r.relrowsecurity || !r.relforcerowsecurity || !r.hasPolicy;
    });
    expect(tenantMisconfigured).toEqual([]);

    // Global tables must have RLS off.
    const globalMisconfigured = GLOBAL_TABLES.filter(
      (t) => byName.get(t)?.relrowsecurity !== false,
    );
    expect(globalMisconfigured).toEqual([]);
  });
});
