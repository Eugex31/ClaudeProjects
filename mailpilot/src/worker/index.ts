import { pollOnce } from "@/worker/poller";

const POLL_INTERVAL_MS = 7000;

let polling = false;

async function tick() {
  if (polling) return;
  polling = true;
  try {
    await pollOnce();
  } catch (err) {
    console.error("[worker] poll error:", err);
  } finally {
    polling = false;
  }
}

console.log(`[worker] started, polling every ${POLL_INTERVAL_MS}ms`);
const interval = setInterval(tick, POLL_INTERVAL_MS);
tick();

function shutdown() {
  console.log("[worker] shutting down");
  clearInterval(interval);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
