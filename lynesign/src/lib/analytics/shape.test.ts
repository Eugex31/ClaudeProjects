import { describe, it, expect } from "vitest";
import { zeroFillByDay, secondsToHM, playHours } from "./shape";

describe("zeroFillByDay", () => {
  it("fills a 3-day range with data for day 2 only", () => {
    const rows: Array<{ date: string; plays: number }> = [{ date: "2026-06-02", plays: 5 }];
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-04T00:00:00Z");

    const result = zeroFillByDay(rows, from, to);

    expect(result).toEqual([
      { date: "2026-06-01", plays: 0 },
      { date: "2026-06-02", plays: 5 },
      { date: "2026-06-03", plays: 0 },
    ]);
  });

  it("returns all zeros when rows is empty", () => {
    const rows: Array<{ date: string; plays: number }> = [];
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-04T00:00:00Z");

    const result = zeroFillByDay(rows, from, to);

    expect(result).toEqual([
      { date: "2026-06-01", plays: 0 },
      { date: "2026-06-02", plays: 0 },
      { date: "2026-06-03", plays: 0 },
    ]);
  });

  it("returns empty array when from equals to", () => {
    const rows: Array<{ date: string; plays: number }> = [{ date: "2026-06-02", plays: 5 }];
    const from = new Date("2026-06-02T00:00:00Z");
    const to = new Date("2026-06-02T00:00:00Z");

    const result = zeroFillByDay(rows, from, to);

    expect(result).toEqual([]);
  });

  it("handles range crossing a month boundary", () => {
    const rows: Array<{ date: string; plays: number }> = [];
    const from = new Date("2026-01-30T00:00:00Z");
    const to = new Date("2026-02-02T00:00:00Z");

    const result = zeroFillByDay(rows, from, to);

    expect(result).toEqual([
      { date: "2026-01-30", plays: 0 },
      { date: "2026-01-31", plays: 0 },
      { date: "2026-02-01", plays: 0 },
    ]);
  });

  it("ignores rows with dates outside the range", () => {
    const rows: Array<{ date: string; plays: number }> = [
      { date: "2026-05-31", plays: 1 },
      { date: "2026-06-02", plays: 5 },
      { date: "2026-06-04", plays: 3 },
    ];
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-04T00:00:00Z");

    const result = zeroFillByDay(rows, from, to);

    expect(result).toEqual([
      { date: "2026-06-01", plays: 0 },
      { date: "2026-06-02", plays: 5 },
      { date: "2026-06-03", plays: 0 },
    ]);
  });

  it("includes the day of a non-midnight `to` bound", () => {
    // The raw SQL counts events with `airedAt < to`, so a `to` at 10:00 still
    // covers airings earlier that same day. The zero-fill must include the day.
    const rows: Array<{ date: string; plays: number }> = [{ date: "2026-06-03", plays: 7 }];
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-03T10:00:00Z");

    const result = zeroFillByDay(rows, from, to);

    expect(result.map((r) => r.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(result[2]).toEqual({ date: "2026-06-03", plays: 7 });
  });

  it("clamps a span far larger than the ceiling to at most 1000 entries", () => {
    const from = new Date("2000-01-01T00:00:00Z");
    const to = new Date("2020-01-01T00:00:00Z"); // over 7000 days

    const result = zeroFillByDay([], from, to);

    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result).toHaveLength(1000);
    // The clamp keeps the most recent days: the last entry is the day before `to`.
    expect(result[result.length - 1].date).toBe("2019-12-31");
  });
});

describe("secondsToHM", () => {
  it("returns '0:00' for 0 seconds", () => {
    expect(secondsToHM(0)).toBe("0:00");
  });

  it("returns '0:00' for 59 seconds", () => {
    expect(secondsToHM(59)).toBe("0:00");
  });

  it("returns '0:01' for 60 seconds", () => {
    expect(secondsToHM(60)).toBe("0:01");
  });

  it("returns '1:01' for 3661 seconds", () => {
    expect(secondsToHM(3661)).toBe("1:01");
  });

  it("returns '10:00' for 36000 seconds", () => {
    expect(secondsToHM(36000)).toBe("10:00");
  });
});

describe("playHours", () => {
  it("returns '0.0' for 0 seconds", () => {
    expect(playHours(0)).toBe("0.0");
  });

  it("returns '0.5' for 1800 seconds", () => {
    expect(playHours(1800)).toBe("0.5");
  });

  it("returns '12.5' for 45000 seconds", () => {
    expect(playHours(45000)).toBe("12.5");
  });
});
