/**
 * Shared database helpers for the isolation (vitest) and e2e (Playwright)
 * suites.
 *
 * `resetDb` wipes every application table so no test leaks rows into the next.
 * `seedPlans` restores the four `Plan` rows the app's plan-limit checks and the
 * registration flow depend on. Both talk to whatever `DATABASE_URL` the process
 * was started with: the vitest suites point at the dev database, the Playwright
 * `webServer` and its specs point at `lynesign_test`.
 */

import { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/db/root";

/**
 * TRUNCATE every table in the `public` schema except Prisma's own migration
 * ledger, `RESTART IDENTITY CASCADE`. Enumerated from the catalog rather than
 * hard-coded so a new model cannot silently escape the reset. TRUNCATE is not
 * filtered by row-level security, so this clears rows for every organization
 * regardless of the connection's `app.current_org`.
 */
export async function resetDb(): Promise<void> {
  // `tablename` is Postgres type `name`; cast to text so the driver adapter can
  // deserialize it.
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;

  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** The four plans, byte-identical to `prisma/seed.ts`. */
const PLANS: Array<Parameters<typeof prisma.plan.upsert>[0]["create"]> = [
  { key: PlanKey.TRIAL, name: "Trial", maxScreens: 3, maxUsers: 3, maxLocations: 1, maxStorageBytes: BigInt(1_073_741_824), isPublic: false },
  { key: PlanKey.STARTER, name: "Starter", maxScreens: 10, maxUsers: 10, maxLocations: 3, maxStorageBytes: BigInt(10_737_418_240) },
  { key: PlanKey.GROWTH, name: "Growth", maxScreens: 50, maxUsers: 50, maxLocations: 20, maxStorageBytes: BigInt(107_374_182_400) },
  { key: PlanKey.ENTERPRISE, name: "Enterprise", maxScreens: null, maxUsers: null, maxLocations: null, maxStorageBytes: null },
];

/** Upsert the four `Plan` rows. Safe to call after `resetDb`. */
export async function seedPlans(): Promise<void> {
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
  }
}
