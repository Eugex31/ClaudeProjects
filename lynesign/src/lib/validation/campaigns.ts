import { z } from "zod";

/**
 * Input schemas for the campaign server actions. Each action safe-parses its
 * argument straight after the role check as a front gate: it rejects a blank or
 * over-long name, an out-of-range priority, a malformed ISO datetime, a reversed
 * date window and an empty or oversized target batch before any of that reaches
 * the database. The date window is absolute UTC; there is no timezone handling
 * here. When only one of startsAt / endsAt is supplied to an update, the action
 * re-checks the effective window against the stored row itself.
 */
const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500);
const priority = z.number().int().min(0).max(1000);
const isoDate = z.string().datetime();
export const idSchema = z.string().min(1);

export const createCampaignSchema = z
  .object({
    name,
    description: description.optional(),
    playlistId: z.string().min(1),
    startsAt: isoDate,
    endsAt: isoDate,
    priority: priority.optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "The end must be after the start.",
    path: ["endsAt"],
  });

export const updateCampaignSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    playlistId: z.string().min(1).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
    priority: priority.optional(),
  })
  .refine(
    (v) =>
      v.startsAt == null ||
      v.endsAt == null ||
      new Date(v.endsAt) > new Date(v.startsAt),
    { message: "The end must be after the start.", path: ["endsAt"] },
  );

export const setTargetsSchema = z
  .object({
    screenIds: z.array(z.string().min(1)).max(1000),
    locationIds: z.array(z.string().min(1)).max(1000),
  })
  .refine((v) => v.screenIds.length + v.locationIds.length > 0, {
    message: "Choose at least one screen or location.",
  });
