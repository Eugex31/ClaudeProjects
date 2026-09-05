// Local Postgres harness for development and tests.
//
// Docker is unavailable on this machine, so instead of `docker compose up
// postgres` we run a real local PostgreSQL 18 cluster via the
// `embedded-postgres` npm package. The cluster is persistent: it lives in
// ./.pgdata and is started with `pg_ctl start` so the server keeps running
// after this Node process exits. `EmbeddedPostgres` itself is used only for
// the one-time `initialise()` (initdb); lifecycle is driven through pg_ctl
// so the daemon is not torn down by that library's process-exit hook.
//
// Usage:
//   node scripts/dev-db.mjs start   # init (if needed) + start on :5433, ensure db
//   node scripts/dev-db.mjs stop    # stop the cluster
//
// Matches DATABASE_URL in .env / .env.example:
//   postgresql://lynesign_app:lynesign@localhost:5433/lynesign?schema=public
//
// The bootstrap role `lynesign` is a Postgres SUPERUSER and superusers bypass
// row-level security even under FORCE ROW LEVEL SECURITY. So a second,
// non-superuser role `lynesign_app` is created on start and made owner of the
// database and the public schema; the app and the test suite connect as it.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const PGDATA = path.join(REPO_ROOT, ".pgdata");
const LOGFILE = path.join(PGDATA, "postmaster.log");
const PORT = 5433;
const HOST = "localhost";
const ROLE = "lynesign";
const PASSWORD = "lynesign";
const DATABASE = "lynesign";
// Non-superuser application role. Postgres superusers bypass row-level
// security even under FORCE ROW LEVEL SECURITY, so the app and the RLS
// isolation test must connect as this role. It owns the database and the
// public schema (so Prisma migrations keep working) and has CREATEDB so
// `prisma migrate dev` can provision its shadow database.
const APP_ROLE = "lynesign_app";
const APP_PASSWORD = "lynesign";

/** Resolve the pg_ctl binary shipped with the platform's embedded-postgres package. */
async function pgCtlPath() {
  const pkg =
    process.platform === "win32"
      ? "@embedded-postgres/windows-x64"
      : process.platform === "linux"
        ? "@embedded-postgres/linux-x64"
        : process.platform === "darwin"
          ? "@embedded-postgres/darwin-arm64"
          : null;
  if (!pkg) throw new Error(`Unsupported platform: ${process.platform}`);
  return (await import(pkg)).pg_ctl;
}

function pgCtl(pgctl, args) {
  return spawnSync(pgctl, ["-D", PGDATA, ...args], {
    stdio: "ignore",
    windowsHide: true,
  });
}

/** pg_ctl status: exit 0 = running, 3 = not running, 4 = bad data dir. */
function isRunning(pgctl) {
  return pgCtl(pgctl, ["status"]).status === 0;
}

async function canConnect(database = "postgres") {
  const client = new pg.Client({
    host: HOST,
    port: PORT,
    user: ROLE,
    password: PASSWORD,
    database,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitForReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect()) return;
    await sleep(500);
  }
  throw new Error(`Postgres was not accepting connections within ${timeoutMs}ms.`);
}

async function ensureDatabase() {
  const client = new pg.Client({
    host: HOST,
    port: PORT,
    user: ROLE,
    password: PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [DATABASE],
    );
    if (!rowCount) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(DATABASE)}`);
      console.log(`Created database "${DATABASE}".`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Ensure the non-superuser application role exists and owns the database and
 * public schema. Idempotent: safe to run on every start. Run as the bootstrap
 * superuser while connected to the application database (schema-level GRANT /
 * ALTER OWNER must run inside that database).
 */
async function ensureAppRole() {
  const client = new pg.Client({
    host: HOST,
    port: PORT,
    user: ROLE,
    password: PASSWORD,
    database: DATABASE,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  const appRole = client.escapeIdentifier(APP_ROLE);
  const db = client.escapeIdentifier(DATABASE);
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} WITH LOGIN CREATEDB PASSWORD '${APP_PASSWORD}' NOSUPERUSER;
        END IF;
      END $$;
    `);
    await client.query(`ALTER DATABASE ${db} OWNER TO ${appRole}`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${db} TO ${appRole}`);
    await client.query(`GRANT ALL ON SCHEMA public TO ${appRole}`);
    await client.query(`ALTER SCHEMA public OWNER TO ${appRole}`);
    console.log(`Ensured application role "${APP_ROLE}" owns database "${DATABASE}".`);
  } finally {
    await client.end();
  }
}

async function initialiseCluster() {
  console.log(`Initialising Postgres cluster in ${PGDATA} ...`);
  const ep = new EmbeddedPostgres({
    databaseDir: PGDATA,
    port: PORT,
    user: ROLE,
    password: PASSWORD,
    authMethod: "password",
    persistent: true,
    // Force UTF-8 so the cluster matches production Postgres; the Windows
    // initdb default would otherwise be WIN1252.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await ep.initialise();
}

async function start() {
  const pgctl = await pgCtlPath();

  if (isRunning(pgctl)) {
    console.log(`Postgres already running on port ${PORT}.`);
    await ensureDatabase();
    await ensureAppRole();
    console.log(`Ready: postgresql://${APP_ROLE}:${APP_PASSWORD}@${HOST}:${PORT}/${DATABASE}`);
    return;
  }

  if (!existsSync(path.join(PGDATA, "PG_VERSION"))) {
    await initialiseCluster();
  } else {
    // Stale lock from a crashed/killed postmaster would block startup.
    rmSync(path.join(PGDATA, "postmaster.pid"), { force: true });
  }

  console.log(`Starting Postgres on port ${PORT} ...`);
  // Detached + stdio:"ignore" so the child postgres does not inherit this
  // process's handles (which would keep it alive on Windows) and the
  // cluster survives after this script exits. `detached: true` also puts the
  // child in its own process group, so a SIGINT/SIGHUP delivered to this
  // script by Git Bash (Ctrl+C, terminal close) is NOT forwarded to the
  // postmaster. Readiness is polled directly.
  const child = spawn(
    pgctl,
    ["-D", PGDATA, "-l", LOGFILE, "-o", `-p ${PORT}`, "start"],
    { stdio: "ignore", detached: true, windowsHide: true },
  );
  child.unref();

  await waitForReady();
  await ensureDatabase();
  await ensureAppRole();
  console.log(`Ready: postgresql://${APP_ROLE}:${APP_PASSWORD}@${HOST}:${PORT}/${DATABASE}`);
}

async function stop() {
  const pgctl = await pgCtlPath();
  if (!isRunning(pgctl)) {
    console.log("Postgres is not running.");
    return;
  }
  const res = pgCtl(pgctl, ["-m", "fast", "-w", "stop"]);
  if (res.status !== 0) throw new Error(`pg_ctl stop failed (exit ${res.status}).`);
  console.log("Postgres stopped.");
}

const cmd = process.argv[2];
try {
  if (cmd === "start") await start();
  else if (cmd === "stop") await stop();
  else {
    console.error("Usage: node scripts/dev-db.mjs <start|stop>");
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
