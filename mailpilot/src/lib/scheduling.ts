export function randomDelaySeconds(minSeconds: number, maxSeconds: number): number {
  return minSeconds + Math.random() * (maxSeconds - minSeconds);
}

/**
 * Computes send timestamps for `count` recipients starting from `startFrom`,
 * with a randomized delay between each send. The first recipient is
 * scheduled at `startFrom` itself (no initial wait).
 */
export function computeSchedule(
  count: number,
  delayMinSeconds: number,
  delayMaxSeconds: number,
  startFrom: Date = new Date()
): Date[] {
  const schedule: Date[] = [];
  let cursor = startFrom.getTime();
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      cursor += randomDelaySeconds(delayMinSeconds, delayMaxSeconds) * 1000;
    }
    schedule.push(new Date(cursor));
  }
  return schedule;
}

const MAX_ATTEMPTS = 5;

export function computeBackoff(attemptCount: number): number {
  const base = Math.min(2 ** attemptCount * 30, 1800);
  const jitter = Math.random() * base * 0.2;
  return base + jitter;
}

export function isMaxAttemptsReached(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}
