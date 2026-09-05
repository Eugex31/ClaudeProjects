const DAY_MS = 86_400_000;

/**
 * Defensive ceiling on the number of day buckets this function will produce. The
 * analytics page already clamps its own range, but no future caller can be
 * allowed to pass an unbounded span and make this loop, or the chart that
 * renders its output, exhaust memory.
 */
const MAX_DAYS = 1000;

export function zeroFillByDay(
  rows: Array<{ date: string; plays: number }>,
  from: Date,
  to: Date
): Array<{ date: string; plays: number }> {
  if (from >= to) {
    return [];
  }

  const result: Array<{ date: string; plays: number }> = [];
  const rowsByDate = new Map(rows.map((row) => [row.date, row.plays]));

  // When the span exceeds MAX_DAYS, keep the most recent MAX_DAYS days.
  const spanStart =
    (to.getTime() - from.getTime()) / DAY_MS > MAX_DAYS
      ? new Date(to.getTime() - MAX_DAYS * DAY_MS)
      : from;

  const current = new Date(spanStart);
  // Inclusive last day derived from `to - 1ms`, so a `to` that is not UTC
  // midnight still includes its own partial day, matching the SQL `airedAt < to`
  // that the raw report query uses.
  const lastDateStr = new Date(to.getTime() - 1).toISOString().slice(0, 10);

  while (result.length < MAX_DAYS) {
    const currentDateStr = current.toISOString().slice(0, 10);
    if (currentDateStr > lastDateStr) {
      break;
    }

    const plays = rowsByDate.get(currentDateStr) ?? 0;
    result.push({ date: currentDateStr, plays });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

export function secondsToHM(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${hours}:${mins.toString().padStart(2, "0")}`;
}

export function playHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  return hours.toFixed(1);
}
