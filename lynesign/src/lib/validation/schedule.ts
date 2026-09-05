import { z } from "zod";

/**
 * Input schemas and time helpers for the schedule rule server actions. Each
 * action safe-parses its argument straight after the role check as a front gate:
 * it rejects a malformed payload, an out of range weekday, a reversed minute
 * window and a reversed effective window before any of that reaches the
 * database. Minute windows are minute-of-day integers (0..1439 for the start,
 * 1..1440 for the end) and are half-open, matching the overlap module. Effective
 * dates are plain calendar dates as "YYYY-MM-DD" strings; there is no timezone
 * handling here.
 */

/**
 * Parse a "HH:MM" 24 hour string to minutes of the day. Throws on anything
 * malformed. Accepts the end-of-day sentinel "24:00" as 1440 so a rule that
 * runs to midnight is authorable; "24:01", "25:00" and other out of range
 * values are still rejected.
 */
export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Time must look like HH:MM in 24 hour form.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 1440;
  if (hours > 23 || minutes > 59) {
    throw new Error("Time must be a real 24 hour clock value.");
  }
  return hours * 60 + minutes;
}

/** Format minutes of the day back to a zero padded "HH:MM" string. */
export function minutesToHHMM(n: number): string {
  const hours = Math.floor(n / 60);
  const minutes = n % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const optionalName = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : undefined));

const cuid = z.string().cuid();
const dateString = z.string().date();
const startMinute = z.number().int().min(0).max(1439);
const endMinute = z.number().int().min(1).max(1440);

export const daysOfWeekSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: "Each weekday can appear once.",
  });

export const createScheduleRuleSchema = z
  .object({
    name: optionalName,
    playlistId: cuid.optional(),
    campaignId: cuid.optional(),
    daysOfWeek: daysOfWeekSchema,
    startMinute,
    endMinute,
    effectiveFrom: dateString.optional(),
    effectiveUntil: dateString.optional(),
    enabled: z.boolean().default(true),
    screenIds: z.array(cuid).max(1000),
    locationIds: z.array(cuid).max(1000),
  })
  .refine((v) => (v.playlistId ? 1 : 0) + (v.campaignId ? 1 : 0) === 1, {
    message: "Choose either a playlist or a campaign.",
    path: ["playlistId"],
  })
  .refine((v) => v.endMinute > v.startMinute, {
    message: "End time must be after start time.",
    path: ["endMinute"],
  })
  .refine((v) => v.screenIds.length + v.locationIds.length > 0, {
    message: "Target at least one screen or location.",
  })
  .refine(
    (v) => !v.effectiveFrom || !v.effectiveUntil || v.effectiveUntil >= v.effectiveFrom,
    { message: "The effective end must not be before the effective start.", path: ["effectiveUntil"] },
  );

export const updateScheduleRuleSchema = z
  .object({
    name: optionalName,
    playlistId: cuid.nullable().optional(),
    campaignId: cuid.nullable().optional(),
    daysOfWeek: daysOfWeekSchema.optional(),
    startMinute: startMinute.optional(),
    endMinute: endMinute.optional(),
    effectiveFrom: dateString.nullable().optional(),
    effectiveUntil: dateString.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) => {
      const payloadInPatch = v.playlistId !== undefined || v.campaignId !== undefined;
      if (!payloadInPatch) return true;
      if (v.playlistId != null && v.campaignId === null) return true;
      if (v.campaignId != null && v.playlistId === null) return true;
      return false;
    },
    { message: "Choose either a playlist or a campaign.", path: ["playlistId"] },
  )
  .refine(
    (v) => v.startMinute === undefined || v.endMinute === undefined || v.endMinute > v.startMinute,
    { message: "End time must be after start time.", path: ["endMinute"] },
  )
  .refine(
    (v) =>
      v.effectiveFrom == null ||
      v.effectiveUntil == null ||
      v.effectiveUntil >= v.effectiveFrom,
    { message: "The effective end must not be before the effective start.", path: ["effectiveUntil"] },
  );

export const setScheduleTargetsSchema = z
  .object({
    screenIds: z.array(cuid).max(1000),
    locationIds: z.array(cuid).max(1000),
  })
  .refine((v) => v.screenIds.length + v.locationIds.length > 0, {
    message: "Target at least one screen or location.",
  });

export const idSchema = z.object({ id: cuid });
