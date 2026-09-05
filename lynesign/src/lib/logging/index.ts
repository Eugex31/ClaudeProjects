import pino from "pino";
import { randomUUID } from "node:crypto";

/**
 * Process-wide logger. In production it writes newline-delimited JSON straight
 * to stdout (no transport), which is what a log shipper expects. Everywhere else
 * it routes through `pino-pretty` for readable local output.
 *
 * Level precedence: an explicit `LOG_LEVEL` always wins; otherwise `info` in
 * production and `debug` in development and test.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

/**
 * Runs `fn` with a child logger that carries a fresh random `reqId`, so every
 * line emitted for one request or job can be correlated after the fact.
 */
export async function withRequestId<T>(fn: (log: pino.Logger) => Promise<T>): Promise<T> {
  const child = logger.child({ reqId: randomUUID() });
  return fn(child);
}
