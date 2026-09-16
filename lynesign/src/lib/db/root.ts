import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // The pool is ours on purpose, not just a side effect of using the driver
  // adapter. src/lib/db/tenant.ts runs every tenant query inside an interactive
  // transaction that first sets `app.current_org`, so connection checkout is on
  // the hot path and its limits are a tenancy concern, not a tuning detail.
  // Validated, not coerced: `Number("ten")` is NaN, and `pg` would quietly fall
  // back to its own default while the operator believed the override took.
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
  if (!Number.isInteger(poolMax) || poolMax < 1) {
    throw new Error(
      `DATABASE_POOL_MAX must be a positive integer (got ${JSON.stringify(process.env.DATABASE_POOL_MAX)})`,
    );
  }

  return new Pool({
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    // Fail loudly rather than hanging forever when the pool is exhausted -- with
    // per-call transactions, exhaustion is the failure mode to watch for.
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * The `pg` pool backing the Prisma client. Exported so a long-running process
 * (the worker) can drain it on shutdown; application code should not touch it.
 */
export const pgPool = globalForPrisma.pgPool ?? createPool();

/**
 * Unscoped Prisma client: neither the argument-rewriting guard of
 * `src/lib/db/tenant.ts` nor the RLS GUC applies to anything issued through it.
 *
 * It is NOT confined to one directory. It is confined to a fixed, enumerated set
 * of call sites, each of which either carries an explicit `organizationId` that
 * a validated `requireOrg()` / `requireRole()` produced, touches a global
 * (non-tenant) table, or is legitimately cross-organization. That list is
 * mechanically enforced: `eslint.config.mjs` forbids importing this module
 * everywhere and re-allows it file by file, so a NEW importer fails lint. Adding
 * a file to that allow-list is a deliberate act, not an accident.
 *
 * The sanctioned importers and why each one is safe:
 *
 *  - `src/lib/db/tenant.ts` -- builds the guarded facade on top of this client.
 *  - `src/lib/auth/config.ts`, `session.ts` -- the next-auth adapter and the
 *    credential-session writer work on global `User` / `Session` tables.
 *  - `src/lib/auth/context.ts` -- the bootstrap membership lookup that decides
 *    which organization a request is scoped to; it cannot itself be scoped.
 *  - `src/lib/plan-limits/index.ts` -- counts and plan lookups with an explicit
 *    `organizationId` in every `where`, plus the global `Plan` table.
 *  - `src/lib/audit/index.ts` -- the unscoped fallback path for audit rows that
 *    have no organization (platform-level events).
 *  - `src/lib/email/index.ts` -- `OutboundEmail` is a global, non-tenant queue.
 *  - `src/lib/slug.ts` -- uniqueness check across all `Organization` rows.
 *  - `src/lib/player/device-auth.ts`, `src/app/api/player/**` -- device-token
 *    authentication: the caller is a screen, not a user, so there is no org
 *    context yet. The token hash is what establishes the org.
 *  - `src/app/api/health/route.ts` -- a liveness probe, no tenant data.
 *  - `src/app/(auth)/actions.ts` -- sign-up, sign-in, reset and invite accept:
 *    global `User` / `Session` / `Organization` rows, before any org context
 *    exists.
 *  - `src/app/(app)/layout.tsx`, `(app)/settings/page.tsx`,
 *    `(app)/settings/actions.ts`, `(app)/billing/page.tsx` -- organization and
 *    membership reads for the org switcher and billing, each keyed on a
 *    validated `ctx.organizationId` or on the signed-in user's own id.
 *  - `src/app/(app)/users/actions.ts` -- the global `User` and `Organization`
 *    lookups only; its `Invitation` and `Membership` work goes through `ctx.db`.
 *  - `src/app/(app)/media/actions.ts` -- `MediaProcessingJob` is a global
 *    (non-tenant) queue table; every `MediaAsset` / `MediaFolder` access in the
 *    file goes through `ctx.db`.
 *  - `src/worker/jobs/**` -- background jobs are cross-organization by design.
 *  - `scripts/**`, `prisma/**` -- migration and seed tooling.
 *  - `**\/*.test.ts(x)`, `src/test/**` -- fixtures must be able to set up and
 *    assert across organizations, including the isolation suite that proves the
 *    guard works.
 *
 * Everything not on that list must go through `forOrg` / `withOrgTransaction`.
 *
 * NOTE for anything that may run on the edge runtime (middleware, edge routes):
 * `pg` is Node-only. Keep this module out of those bundles.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(pgPool) });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pgPool;
}
