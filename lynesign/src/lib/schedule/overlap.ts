import type { TenantTransactionClient } from "@/lib/db/tenant";

/**
 * Overlap predicates for schedule rules, plus the transaction-time guard the
 * CRUD actions call before they write.
 *
 * Two range conventions live here and they are deliberately different:
 *
 *  - Minute ranges are half-open. `[540, 720)` and `[720, 900)` do not overlap;
 *    a rule that ends at 12:00 and one that starts at 12:00 can coexist.
 *  - Effective-date ranges are inclusive. `..2026-06-30` and `2026-06-30..`
 *    overlap on that shared day; only `..2026-06-30` and `2026-07-01..` are
 *    clear of each other.
 */

/** Half-open minute-range overlap. Adjacent ranges (`a.endMinute === b.startMinute`) do not overlap. */
export function minutesOverlap(
  a: { startMinute: number; endMinute: number },
  b: { startMinute: number; endMinute: number },
): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** True when the two weekday lists share at least one day. Weekday values are 0..6. */
export function daysOverlap(a: number[], b: number[]): boolean {
  const seen = new Set(a);
  return b.some((day) => seen.has(day));
}

/**
 * Inclusive overlap of two effective-date ranges on `{ effectiveFrom, effectiveUntil }`.
 * A null `effectiveFrom` is an open start, a null `effectiveUntil` an open end;
 * they compare as `"0000-00-00"` / `"9999-99-99"` sentinels, which sort before
 * and after any real `YYYY-MM-DD` string. Touching ranges (`aUntil === bFrom`)
 * do overlap, unlike minute ranges.
 */
export function datesOverlap(
  a: { effectiveFrom: string | null; effectiveUntil: string | null },
  b: { effectiveFrom: string | null; effectiveUntil: string | null },
): boolean {
  const aFrom = a.effectiveFrom ?? "0000-00-00";
  const aUntil = a.effectiveUntil ?? "9999-99-99";
  const bFrom = b.effectiveFrom ?? "0000-00-00";
  const bUntil = b.effectiveUntil ?? "9999-99-99";
  return aFrom <= bUntil && bFrom <= aUntil;
}

/**
 * Thrown by `assertNoScheduleOverlap` for the first sibling rule that collides
 * with the candidate on screens, weekdays, minutes and effective dates at once.
 * The carried fields describe that sibling. A later task turns this into a
 * reader-facing string, so the message stays plain.
 */
export class ScheduleOverlapError extends Error {
  readonly conflictName: string | null;
  readonly conflictDays: number[];
  readonly conflictStartMinute: number;
  readonly conflictEndMinute: number;

  constructor(
    conflictName: string | null,
    conflictDays: number[],
    conflictStartMinute: number,
    conflictEndMinute: number,
  ) {
    super("Schedule rule overlaps an existing rule.");
    this.name = "ScheduleOverlapError";
    this.conflictName = conflictName;
    this.conflictDays = conflictDays;
    this.conflictStartMinute = conflictStartMinute;
    this.conflictEndMinute = conflictEndMinute;
  }
}

/** The rule being created or edited, as the CRUD actions know it before the write. */
export interface ScheduleOverlapCandidate {
  id?: string;
  screenIds: string[];
  locationIds: string[];
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}

/**
 * Throw `ScheduleOverlapError` if `candidate` would overlap any enabled,
 * non-archived sibling `ScheduleRule` in the org. Two rules overlap when their
 * resolved screen sets intersect and their weekdays, minutes and effective
 * dates all overlap. A location target resolves to that location's direct
 * screens only. `candidate.id`, when set, excludes the row being edited.
 */
export async function assertNoScheduleOverlap(
  tx: TenantTransactionClient,
  orgId: string,
  candidate: ScheduleOverlapCandidate,
): Promise<void> {
  // Resolve the candidate's screen set: direct screens plus the direct screens
  // of each target location.
  const locScreens = candidate.locationIds.length
    ? await tx.screen.findMany({
        where: { locationId: { in: candidate.locationIds } },
        select: { id: true },
      })
    : [];
  const candScreens = new Set<string>([...candidate.screenIds, ...locScreens.map((s) => s.id)]);
  if (candScreens.size === 0) return;

  // Small N per org: load every enabled, non-archived sibling with its targets.
  const siblings = await tx.scheduleRule.findMany({
    where: {
      organizationId: orgId,
      enabled: true,
      archivedAt: null,
      id: { not: candidate.id ?? "" },
    },
    select: {
      id: true,
      name: true,
      daysOfWeek: true,
      startMinute: true,
      endMinute: true,
      effectiveFrom: true,
      effectiveUntil: true,
      screens: { select: { screenId: true } },
      locations: { select: { locationId: true } },
    },
  });

  const allLocIds = [...new Set(siblings.flatMap((s) => s.locations.map((l) => l.locationId)))];
  const locToScreens = new Map<string, string[]>();
  if (allLocIds.length) {
    const rows = await tx.screen.findMany({
      where: { locationId: { in: allLocIds } },
      select: { id: true, locationId: true },
    });
    for (const r of rows) {
      locToScreens.set(r.locationId, [...(locToScreens.get(r.locationId) ?? []), r.id]);
    }
  }

  const toDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

  for (const sib of siblings) {
    const sibScreens = new Set<string>(sib.screens.map((s) => s.screenId));
    for (const l of sib.locations) {
      for (const sid of locToScreens.get(l.locationId) ?? []) sibScreens.add(sid);
    }
    const shareScreen = [...sibScreens].some((sid) => candScreens.has(sid));
    if (!shareScreen) continue;

    const sibDates = {
      effectiveFrom: toDate(sib.effectiveFrom),
      effectiveUntil: toDate(sib.effectiveUntil),
    };
    if (
      daysOverlap(candidate.daysOfWeek, sib.daysOfWeek) &&
      minutesOverlap(candidate, sib) &&
      datesOverlap(candidate, sibDates)
    ) {
      throw new ScheduleOverlapError(sib.name, sib.daysOfWeek, sib.startMinute, sib.endMinute);
    }
  }
}
