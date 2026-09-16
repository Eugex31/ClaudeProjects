export type NewsletterRecurrence = {
  frequency: "WEEKLY" | "MONTHLY";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hourUtc: number;
  minuteUtc: number;
};

function daysInUtcMonth(year: number, monthIndex: number): number {
  // Day 0 of "next month" is the last day of the target month.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Finds the next WEEKLY/MONTHLY occurrence strictly after `after` — used both
// at activation (from now()) and after each cycle (from the *scheduled*
// nextSendAt, not whenever the cycle actually ran, so a slightly-late tick
// never drifts the whole future schedule forward).
export function computeNextRunAt(recurrence: NewsletterRecurrence, after: Date): Date {
  const { frequency, dayOfWeek, dayOfMonth, hourUtc, minuteUtc } = recurrence;

  if (frequency === "WEEKLY") {
    const targetDay = dayOfWeek ?? 0;
    const candidate = new Date(after);
    candidate.setUTCHours(hourUtc, minuteUtc, 0, 0);
    // Move forward one day at a time until both the weekday and the "strictly
    // after" requirement are satisfied — at most 7 iterations.
    while (candidate.getUTCDay() !== targetDay || candidate.getTime() <= after.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(hourUtc, minuteUtc, 0, 0);
    }
    return candidate;
  }

  // MONTHLY
  const targetDayOfMonth = dayOfMonth ?? 1;
  let year = after.getUTCFullYear();
  let month = after.getUTCMonth();
  for (let i = 0; i < 24; i++) {
    const clampedDay = Math.min(targetDayOfMonth, daysInUtcMonth(year, month));
    const candidate = new Date(Date.UTC(year, month, clampedDay, hourUtc, minuteUtc, 0, 0));
    if (candidate.getTime() > after.getTime()) {
      return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  // Unreachable in practice (24 months of headroom), but keeps the return type honest.
  throw new Error("computeNextRunAt: could not find a future occurrence within 24 months");
}
