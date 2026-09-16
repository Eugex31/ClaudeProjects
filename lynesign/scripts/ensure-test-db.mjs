// Provision the dedicated end-to-end test database.
//
// The e2e (Playwright) suite must never touch the dev database `lynesign`, so
// it runs against a separate `lynesign_test` database on the same local
// cluster (scripts/dev-db.mjs, port 5433). This script is idempotent:
//
//   1. ensure the local cluster is running (delegates to dev-db.mjs start),
//   2. CREATE DATABASE lynesign_test OWNER lynesign_app  (if absent),
//   3. prisma migrate deploy  against the test URL,
//   4. seed the 4 plans + the platform super admin against the test URL.
//
// Steps 3 and 4 set DATABASE_URL through the child process environment rather
// than an inline `VAR=value cmd` prefix, because that shell syntax does not
// work in cmd.exe on Windows where npm scripts run.
//
// On CI (CI=true) steps 1 and 2 are skipped: .github/workflows/ci.yml runs a
// real postgres:16 service container and provisions the lynesign_app role and
// the lynesign_test database itself, so only the migrate + seed steps run.
//
// Usage: node scripts/ensure-test-db.mjs

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const HOST = "localhost";
const PORT = 5433;
const BOOTSTRAP_ROLE = "lynesign";
const BOOTSTRAP_PASSWORD = "lynesign";
const APP_ROLE = "lynesign_app";
const TEST_DATABASE = "lynesign_test";

export const TEST_DATABASE_URL = `postgresql://${APP_ROLE}:lynesign@${HOST}:${PORT}/${TEST_DATABASE}?schema=public`;

function run(command, args, extraEnv) {
  const res = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${res.status ?? "signal"}).`);
  }
}

async function ensureTestDatabase() {
  const client = new pg.Client({
    host: HOST,
    port: PORT,
    user: BOOTSTRAP_ROLE,
    password: BOOTSTRAP_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [TEST_DATABASE],
    );
    if (rowCount) {
      console.log(`Database "${TEST_DATABASE}" already exists.`);
      return;
    }
    await client.query(
      `CREATE DATABASE ${client.escapeIdentifier(TEST_DATABASE)} OWNER ${client.escapeIdentifier(APP_ROLE)}`,
    );
    console.log(`Created database "${TEST_DATABASE}" owned by "${APP_ROLE}".`);
  } finally {
    await client.end();
  }
}

async function main() {
  // On CI (GitHub Actions sets CI=true) the Postgres service, the lynesign_app
  // role, and the lynesign_test database are all provisioned by a workflow step
  // -- there is no embedded-postgres cluster to start and no bootstrap superuser
  // to connect as. Skip steps 1-2 and bring the schema and seed data up to date
  // exactly as the local path does.
  if (!process.env.CI) {
    // 1. Cluster up (idempotent; prints "already running" on repeat calls).
    run("node", ["scripts/dev-db.mjs", "start"]);

    // 2. The test database itself.
    await ensureTestDatabase();
  }

  // 3. Schema.
  run("npx", ["--no-install", "prisma", "migrate", "deploy"], {
    DATABASE_URL: TEST_DATABASE_URL,
  });

  // 4. Reference data (4 plans + super admin), same seed the dev DB uses.
  run("npx", ["--no-install", "tsx", "prisma/seed.ts"], {
    DATABASE_URL: TEST_DATABASE_URL,
  });

  console.log(`Test database ready: ${TEST_DATABASE_URL}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
