import { prisma } from "@/lib/prisma";

/**
 * Atomic fixed-window rate limiter backed by Postgres (no Redis needed at
 * this app's scale). Returns true if the request is allowed.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowMs = windowSeconds * 1000;
  const windowIndex = Math.floor(Date.now() / windowMs);
  const bucketKey = `${key}:${windowIndex}`;

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { key: bucketKey },
    create: { key: bucketKey, windowStart: new Date(windowIndex * windowMs), count: 1 },
    update: { count: { increment: 1 } },
  });

  return bucket.count <= limit;
}
