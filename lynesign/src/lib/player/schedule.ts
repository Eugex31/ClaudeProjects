// Pure helpers for schedule-rule evaluation. No I/O. zonedNow is deterministic
// given (now, timeZone); scheduleRuleMatches given (rule, at).

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function zonedNow(now: Date, timeZone: string): { weekday: number; minute: number; date: string } {
  // Throws RangeError for an unknown zone -- callers catch it.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = WEEKDAY_INDEX[get("weekday")];
  // Some ICU builds emit "24" for local midnight under h23; clamp to 0.
  const minute = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { weekday, minute, date };
}

export type ScheduleRuleCandidate = {
  id: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
};

export function scheduleRuleMatches(
  rule: ScheduleRuleCandidate,
  at: { weekday: number; minute: number; date: string },
): boolean {
  if (!rule.daysOfWeek.includes(at.weekday)) return false;
  if (at.minute < rule.startMinute || at.minute >= rule.endMinute) return false;
  if (rule.effectiveFrom !== null && at.date < rule.effectiveFrom) return false;
  if (rule.effectiveUntil !== null && at.date > rule.effectiveUntil) return false;
  return true;
}
