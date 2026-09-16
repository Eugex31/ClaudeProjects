// Local S3 for dev and tests without Docker: runs the MinIO binary as a
// detached subprocess. Mirrors scripts/dev-db.mjs.
//
// Usage:
//   node scripts/dev-storage.mjs start  # download binary on first run, launch
//                                       # on :9000 (data in .minio/data),
//                                       # health-check, ensure the bucket
//   node scripts/dev-storage.mjs stop   # kill it
//
// Matches the STORAGE_* block in .env / .env.example:
//   STORAGE_ENDPOINT=http://localhost:9000
//   STORAGE_ACCESS_KEY_ID=lynesign
//   STORAGE_SECRET_ACCESS_KEY=lynesign-dev-secret
//   STORAGE_BUCKET=lynesign-media
//
// Idempotent: `start` is a no-op when MinIO already answers on :9000.

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".minio");
const DATA = path.join(DIR, "data");
const PIDFILE = path.join(DIR, "minio.pid");
const BIN = path.join(DIR, platform() === "win32" ? "minio.exe" : "minio");
const PORT = 9000;
const USER = "lynesign";
const PASS = "lynesign-dev-secret";
const BUCKET = "lynesign-media";
const HEALTH = `http://localhost:${PORT}/minio/health/live`;

function downloadUrl() {
  const os =
    platform() === "win32"
      ? "windows-amd64"
      : platform() === "darwin"
        ? `darwin-${arch() === "arm64" ? "arm64" : "amd64"}`
        : "linux-amd64";
  const file = platform() === "win32" ? "minio.exe" : "minio";
  return `https://dl.min.io/server/minio/release/${os}/${file}`;
}

async function ensureBinary() {
  if (existsSync(BIN)) return;
  mkdirSync(DIR, { recursive: true });
  const url = downloadUrl();
  console.log(`Downloading MinIO binary (one time) from ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `MinIO download failed: ${res.status} ${res.statusText}. Fall back to s3rver (see plan Task 1).`,
    );
  }
  await writeFile(BIN, Buffer.from(await res.arrayBuffer()));
  if (platform() !== "win32") chmodSync(BIN, 0o755);
  console.log(`Saved ${BIN}`);
}

async function isLive() {
  try {
    const r = await fetch(HEALTH);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureBucket() {
  const { S3Client, CreateBucketCommand, HeadBucketCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const c = new S3Client({
    endpoint: `http://localhost:${PORT}`,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: USER, secretAccessKey: PASS },
  });
  try {
    await c.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return;
  } catch {
    // not found or not reachable yet; fall through to create
  }
  await c.send(new CreateBucketCommand({ Bucket: BUCKET }));
  console.log(`Created bucket ${BUCKET}`);
}

async function start() {
  await ensureBinary();
  mkdirSync(DATA, { recursive: true });

  if (await isLive()) {
    await ensureBucket();
    console.log(`MinIO already up on :${PORT}`);
    return;
  }

  // Detached + stdio:"ignore" so the child does not inherit this process's
  // handles and survives after this script exits. detached also puts it in its
  // own process group so a Ctrl+C to this script is not forwarded to MinIO.
  const child = spawn(BIN, ["server", DATA, "--address", `:${PORT}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      MINIO_ROOT_USER: USER,
      MINIO_ROOT_PASSWORD: PASS,
    },
  });
  child.unref();
  if (child.pid) writeFileSync(PIDFILE, String(child.pid));

  let live = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await isLive()) {
      live = true;
      break;
    }
  }
  if (!live) throw new Error(`MinIO did not become healthy on :${PORT} within 20s.`);

  await ensureBucket();
  console.log(`MinIO up on :${PORT} (user ${USER}, bucket ${BUCKET})`);
}

function stop() {
  if (!existsSync(PIDFILE)) {
    console.log("MinIO not running (no pidfile).");
    return;
  }
  const pid = Number(readFileSync(PIDFILE, "utf8"));
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
    if (platform() === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" });
    }
  }
  rmSync(PIDFILE, { force: true });
  console.log("MinIO stopped.");
}

const cmd = process.argv[2];
try {
  if (cmd === "start") await start();
  else if (cmd === "stop") stop();
  else {
    console.error("Usage: node scripts/dev-storage.mjs <start|stop>");
    process.exit(2);
  }
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
