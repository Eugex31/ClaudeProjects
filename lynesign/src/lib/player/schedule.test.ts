import { describe, it, expect } from "vitest";
import { zonedNow, scheduleRuleMatches, type ScheduleRuleCandidate } from "./schedule";

// 2026-06-15T02:30:00Z straddles local midnight in the Americas and is nowhere
// near a DST transition. New York (EDT, UTC-4) is still 22:30 on 2026-06-14,
// while the UTC date is already 2026-06-15: the cross-date case.
const ref = new Date("2026-06-15T02:30:00Z");

describe("zonedNow", () => {
  it("derives weekday, minute, and local date in America/New_York (cross-date)", () => {
    expect(zonedNow(ref, "America/New_York")).toEqual({ weekday: 0, minute: 22 * 60 + 30, date: "2026-06-14" });
  });
  it("derives the same instant in Asia/Tokyo (UTC+9, no DST)", () => {
    expect(zonedNow(ref, "Asia/Tokyo")).toEqual({ weekday: 1, minute: 11 * 60 + 30, date: "2026-06-15" });
  });
  it("handles UTC+14 in Pacific/Kiritimati", () => {
    expect(zonedNow(ref, "Pacific/Kiritimati")).toEqual({ weekday: 1, minute: 16 * 60 + 30, date: "2026-06-15" });
  });
  it("reports exact local midnight as minute 0", () => {
    // 2026-06-14T15:00:00Z is exactly 2026-06-15 00:00 in Asia/Tokyo.
    expect(zonedNow(new Date("2026-06-14T15:00:00Z"), "Asia/Tokyo")).toEqual({ weekday: 1, minute: 0, date: "2026-06-15" });
  });
  it("throws RangeError on a bad zone", () => {
    expect(() => zonedNow(ref, "Not/AZone")).toThrow(RangeError);
  });
});

describe("scheduleRuleMatches", () => {
  const base: ScheduleRuleCandidate = { id: "r1", daysOfWeek: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, effectiveFrom: null, effectiveUntil: null };
  it("matches inside the window on a listed weekday", () => {
    expect(scheduleRuleMatches(base, { weekday: 3, minute: 600, date: "2026-06-01" })).toBe(true);
  });
  it("is half-open: start included, end excluded", () => {
    expect(scheduleRuleMatches(base, { weekday: 3, minute: 540, date: "2026-06-01" })).toBe(true);
    expect(scheduleRuleMatches(base, { weekday: 3, minute: 1020, date: "2026-06-01" })).toBe(false);
  });
  it("rejects an unlisted weekday", () => {
    expect(scheduleRuleMatches(base, { weekday: 0, minute: 600, date: "2026-06-01" })).toBe(false);
  });
  it("honours inclusive effective bounds", () => {
    const bounded = { ...base, effectiveFrom: "2026-06-01", effectiveUntil: "2026-06-30" };
    expect(scheduleRuleMatches(bounded, { weekday: 3, minute: 600, date: "2026-06-01" })).toBe(true);
    expect(scheduleRuleMatches(bounded, { weekday: 3, minute: 600, date: "2026-06-30" })).toBe(true);
    expect(scheduleRuleMatches(bounded, { weekday: 3, minute: 600, date: "2026-05-31" })).toBe(false);
    expect(scheduleRuleMatches(bounded, { weekday: 3, minute: 600, date: "2026-07-01" })).toBe(false);
  });
});
