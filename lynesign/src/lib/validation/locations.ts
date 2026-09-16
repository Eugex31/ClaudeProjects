import { z } from "zod";

/**
 * Fields for creating a location. Only `name` is required. `timeZone` and
 * `locale` fall back to the same defaults the database column carries, so a
 * form that leaves them blank still produces a well-formed row. `parentId` is
 * accepted as a free string here; the action verifies it names a location in
 * the caller's own organization before the write (referential-integrity checks
 * are exempt from row-level security).
 */
export const locationSchema = z.object({
  name: z.string().trim().min(1, "Enter a location name."),
  parentId: z.string().trim().min(1).optional(),
  timeZone: z.string().trim().min(1).default("UTC"),
  locale: z.string().trim().min(1).default("en-US"),
  addressLine1: z.string().trim().min(1).optional(),
  addressLine2: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  region: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  countryCode: z.string().trim().min(1).optional(),
});

export type LocationInput = z.infer<typeof locationSchema>;
