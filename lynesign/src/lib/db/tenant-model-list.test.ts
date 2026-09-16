import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { TENANT_MODELS } from "@/lib/db/tenant";
import { TENANT_TABLES } from "@/test/isolation/tenant-tables";

/**
 * The RLS migrations are the source of truth for which tables are tenant-scoped.
 * Every `*_rls*` migration and every later migration that adds tenant tables
 * carries its own `FOREACH t IN ARRAY ARRAY[...]` block; the union of those
 * arrays must equal `TENANT_MODELS` (and, transitively, `TENANT_TABLES` in
 * rls.test.ts). This test fails the moment the three hand-maintained lists drift.
 */
function migrationArray(): string[] {
  // `[^\]]+` spans newlines, so a multi-line `ARRAY[\n 'A',\n 'B'\n]` is matched
  // whole. `ARRAY[]::TEXT[]` (empty) needs one char and is skipped.
  const grab = (sql: string) =>
    [...sql.matchAll(/ARRAY\[([^\]]+)\]/g)].flatMap((m) =>
      m[1].split(",").map((x) => x.trim().replace(/'/g, "")),
    );
  // Every `*_rls*` migration and every later migration that adds tenant tables
  // carries its own `FOREACH t IN ARRAY ARRAY[...]` block. Union them all so a
  // new tenant table only has to be listed in its own migration.
  const names = readdirSync("prisma/migrations").filter((d) => /^\d/.test(d));
  const all = names.flatMap((d) =>
    grab(readFileSync(`prisma/migrations/${d}/migration.sql`, "utf8")),
  );
  return [...new Set(all)];
}

const toModel = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

describe("tenant table lists agree", () => {
  it("TENANT_MODELS matches the union of RLS migration ARRAYs", () => {
    const fromSql = new Set(migrationArray().map(toModel));
    const fromModels = new Set(TENANT_MODELS as readonly string[]);
    expect([...fromModels].filter((m) => !fromSql.has(m))).toEqual([]);
    expect([...fromSql].filter((m) => !fromModels.has(m))).toEqual([]);
  });

  it("TENANT_TABLES (rls.test.ts) maps 1:1 to TENANT_MODELS", () => {
    const fromTables = new Set(TENANT_TABLES.map(toModel));
    const fromModels = new Set(TENANT_MODELS as readonly string[]);
    expect([...fromModels].filter((m) => !fromTables.has(m))).toEqual([]);
    expect([...fromTables].filter((m) => !fromModels.has(m))).toEqual([]);
  });
});
