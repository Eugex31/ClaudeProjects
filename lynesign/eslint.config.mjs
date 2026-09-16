import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Files allowed to import the unscoped Prisma client (`src/lib/db/root.ts`).
 *
 * This list is the enforcement half of the invariant documented at the top of
 * `src/lib/db/root.ts`: the unscoped client is confined to an enumerated set of
 * call sites, each of which either carries an explicit `organizationId` from a
 * validated `requireOrg()` / `requireRole()`, touches a global (non-tenant)
 * table, or is legitimately cross-organization. Everything else must go through
 * `forOrg` / `withOrgTransaction`, which apply the tenant guard and the RLS GUC.
 *
 * Adding an entry here is a deliberate decision that needs the same reasoning.
 * Keep it in sync with the doc comment in `src/lib/db/root.ts`.
 */
const RAW_PRISMA_ALLOWED = [
  // Builds the guarded facade on top of the unscoped client.
  "src/lib/db/tenant.ts",
  // Global User / Session tables, and the bootstrap membership lookup that
  // decides which organization a request is scoped to.
  "src/lib/auth/config.ts",
  "src/lib/auth/session.ts",
  "src/lib/auth/context.ts",
  // Explicit `organizationId` in every where, plus the global Plan table.
  "src/lib/plan-limits/index.ts",
  // Unscoped fallback for platform-level audit rows with no organization.
  "src/lib/audit/index.ts",
  // OutboundEmail is a global, non-tenant queue.
  "src/lib/email/index.ts",
  // Slug uniqueness across all Organization rows.
  "src/lib/slug.ts",
  // Device-token auth: the caller is a screen, so no org context exists yet.
  "src/lib/player/device-auth.ts",
  "src/app/api/player/**",
  // Liveness probe, no tenant data.
  "src/app/api/health/route.ts",
  // Sign-up / sign-in / reset / invite accept: global rows, pre-org-context.
  "src/app/(auth)/actions.ts",
  // Organization and membership reads keyed on a validated ctx.organizationId
  // or on the signed-in user's own id.
  "src/app/(app)/layout.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/settings/actions.ts",
  "src/app/(app)/billing/page.tsx",
  // Global User / Organization lookups only; Invitation and Membership work
  // goes through ctx.db.
  "src/app/(app)/users/actions.ts",
  // MediaProcessingJob is a global (non-tenant) queue table.
  "src/app/(app)/media/actions.ts",
  // Background jobs are cross-organization by design.
  "src/worker/jobs/**",
  // Migration and seed tooling.
  "scripts/**",
  "prisma/**",
  // Fixtures and the isolation suite must be able to reach across orgs.
  "src/test/**",
  "**/*.test.ts",
  "**/*.test.tsx",
];

/** Every spelling of the unscoped client's module path. */
const RAW_PRISMA_PATTERNS = ["@/lib/db/root", "**/lib/db/root", "./root", "../root", "../db/root"];

const RAW_PRISMA_MESSAGE =
  "Import forOrg/withOrgTransaction from @/lib/db/tenant instead. The unscoped client bypasses " +
  "both the tenant guard and RLS. If this call site genuinely needs it, add the file to " +
  "RAW_PRISMA_ALLOWED in eslint.config.mjs and to the doc comment in src/lib/db/root.ts.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code's throwaway git worktrees carry their own full copy of the
    // tree; never lint into them.
    ".claude/**",
  ]),
  {
    name: "lynesign/raw-prisma-confinement",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: RAW_PRISMA_PATTERNS, message: RAW_PRISMA_MESSAGE }],
        },
      ],
    },
  },
  {
    name: "lynesign/raw-prisma-confinement-allowed",
    files: RAW_PRISMA_ALLOWED,
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
