import { describe, it, expect } from "vitest";

import {
  parseHHMM,
  minutesToHHMM,
  daysOfWeekSchema,
  createScheduleRuleSchema,
  updateScheduleRuleSchema,
  setScheduleTargetsSchema,
  idSchema,
} from "./schedule";

const pid = "cplaylist0000000000000001";
const cid = "ccampaign0000000000000001";
const sid = "cscreen000000000000000001";
const lid = "clocation0000000000000001";

const validCreate = {
  playlistId: pid,
  daysOfWeek: [1, 3],
  startMinute: 540,
  endMinute: 600,
  screenIds: [sid],
  locationIds: [lid],
};

describe("parseHHMM / minutesToHHMM", () => {
  it("parses a well formed 24 hour value to minutes of the day", () => {
    expect(parseHHMM("09:30")).toBe(570);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("accepts the end-of-day sentinel 24:00 as 1440", () => {
    expect(parseHHMM("24:00")).toBe(1440);
  });

  it("throws on a malformed value", () => {
    expect(() => parseHHMM("9:5")).toThrow();
    expect(() => parseHHMM("24:01")).toThrow();
    expect(() => parseHHMM("25:00")).toThrow();
    expect(() => parseHHMM("12:60")).toThrow();
    expect(() => parseHHMM("")).toThrow();
    expect(() => parseHHMM("0930")).toThrow();
    expect(() => parseHHMM("ab:cd")).toThrow();
  });

  it("formats minutes of the day back to HH:MM", () => {
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(minutesToHHMM(570)).toBe("09:30");
    expect(minutesToHHMM(1439)).toBe("23:59");
    expect(minutesToHHMM(1440)).toBe("24:00");
  });

  it("round trips both ways", () => {
    for (const n of [0, 1, 59, 60, 540, 570, 725, 1439]) {
      expect(parseHHMM(minutesToHHMM(n))).toBe(n);
    }
    for (const s of ["00:00", "07:05", "09:30", "23:59"]) {
      expect(minutesToHHMM(parseHHMM(s))).toBe(s);
    }
  });
});

describe("daysOfWeekSchema", () => {
  it("accepts one to seven unique weekday numbers", () => {
    expect(daysOfWeekSchema.safeParse([0]).success).toBe(true);
    expect(daysOfWeekSchema.safeParse([0, 6]).success).toBe(true);
    expect(daysOfWeekSchema.safeParse([1, 2, 3, 4, 5, 6, 0]).success).toBe(true);
  });

  it("rejects an empty list, an out of range day, and repeats", () => {
    expect(daysOfWeekSchema.safeParse([]).success).toBe(false);
    expect(daysOfWeekSchema.safeParse([7]).success).toBe(false);
    expect(daysOfWeekSchema.safeParse([-1]).success).toBe(false);
    expect(daysOfWeekSchema.safeParse([1, 1]).success).toBe(false);
    expect(daysOfWeekSchema.safeParse([0, 1, 2, 3, 4, 5, 6, 2]).success).toBe(false);
  });
});

describe("createScheduleRuleSchema", () => {
  it("accepts a valid rule with a playlist payload", () => {
    const parsed = createScheduleRuleSchema.safeParse(validCreate);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.enabled).toBe(true);
  });

  it("accepts a valid rule with a campaign payload", () => {
    expect(
      createScheduleRuleSchema.safeParse({
        ...validCreate,
        playlistId: undefined,
        campaignId: cid,
      }).success,
    ).toBe(true);
  });

  it("rejects neither payload id and both payload ids", () => {
    expect(
      createScheduleRuleSchema.safeParse({ ...validCreate, playlistId: undefined }).success,
    ).toBe(false);
    expect(
      createScheduleRuleSchema.safeParse({ ...validCreate, campaignId: cid }).success,
    ).toBe(false);
  });

  it("rejects an empty daysOfWeek and a day of 7", () => {
    expect(createScheduleRuleSchema.safeParse({ ...validCreate, daysOfWeek: [] }).success).toBe(
      false,
    );
    expect(
      createScheduleRuleSchema.safeParse({ ...validCreate, daysOfWeek: [7] }).success,
    ).toBe(false);
  });

  it("rejects a rule that targets neither a screen nor a location", () => {
    expect(
      createScheduleRuleSchema.safeParse({
        ...validCreate,
        screenIds: [],
        locationIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects an endMinute that is not after startMinute", () => {
    expect(
      createScheduleRuleSchema.safeParse({ ...validCreate, startMinute: 600, endMinute: 600 })
        .success,
    ).toBe(false);
    expect(
      createScheduleRuleSchema.safeParse({ ...validCreate, startMinute: 600, endMinute: 540 })
        .success,
    ).toBe(false);
  });

  it("rejects an effectiveUntil earlier than effectiveFrom", () => {
    expect(
      createScheduleRuleSchema.safeParse({
        ...validCreate,
        effectiveFrom: "2026-02-01",
        effectiveUntil: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      createScheduleRuleSchema.safeParse({
        ...validCreate,
        effectiveFrom: "2026-01-01",
        effectiveUntil: "2026-02-01",
      }).success,
    ).toBe(true);
  });

  it("treats a blank name as absent and trims a padded name", () => {
    const blank = createScheduleRuleSchema.safeParse({ ...validCreate, name: "   " });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.name).toBeUndefined();

    const padded = createScheduleRuleSchema.safeParse({ ...validCreate, name: "  Lobby  " });
    expect(padded.success).toBe(true);
    if (padded.success) expect(padded.data.name).toBe("Lobby");
  });
});

describe("updateScheduleRuleSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateScheduleRuleSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a one sided minute change with no time refine", () => {
    expect(updateScheduleRuleSchema.safeParse({ startMinute: 900 }).success).toBe(true);
  });

  it("rejects a patch naming both payload ids", () => {
    expect(
      updateScheduleRuleSchema.safeParse({ playlistId: pid, campaignId: cid }).success,
    ).toBe(false);
  });

  it("requires the other payload id to be explicitly null when one is named", () => {
    expect(updateScheduleRuleSchema.safeParse({ playlistId: pid }).success).toBe(false);
    expect(
      updateScheduleRuleSchema.safeParse({ playlistId: pid, campaignId: null }).success,
    ).toBe(true);
    expect(
      updateScheduleRuleSchema.safeParse({ campaignId: cid, playlistId: null }).success,
    ).toBe(true);
    expect(
      updateScheduleRuleSchema.safeParse({ playlistId: null, campaignId: null }).success,
    ).toBe(false);
  });

  it("applies the time refine only when both minutes are present", () => {
    expect(
      updateScheduleRuleSchema.safeParse({ startMinute: 600, endMinute: 540 }).success,
    ).toBe(false);
    expect(
      updateScheduleRuleSchema.safeParse({ startMinute: 540, endMinute: 600 }).success,
    ).toBe(true);
  });

  it("applies the date refine only when both dates are present", () => {
    expect(updateScheduleRuleSchema.safeParse({ effectiveUntil: "2026-01-01" }).success).toBe(
      true,
    );
    expect(
      updateScheduleRuleSchema.safeParse({
        effectiveFrom: "2026-02-01",
        effectiveUntil: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});

describe("setScheduleTargetsSchema", () => {
  it("accepts a batch with at least one target", () => {
    expect(setScheduleTargetsSchema.safeParse({ screenIds: [sid], locationIds: [] }).success).toBe(
      true,
    );
    expect(setScheduleTargetsSchema.safeParse({ screenIds: [], locationIds: [lid] }).success).toBe(
      true,
    );
  });

  it("rejects an empty batch and a non cuid id", () => {
    expect(setScheduleTargetsSchema.safeParse({ screenIds: [], locationIds: [] }).success).toBe(
      false,
    );
    expect(
      setScheduleTargetsSchema.safeParse({ screenIds: ["not-a-cuid"], locationIds: [] }).success,
    ).toBe(false);
  });
});

describe("idSchema", () => {
  it("accepts a cuid and rejects anything else", () => {
    expect(idSchema.safeParse({ id: sid }).success).toBe(true);
    expect(idSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(idSchema.safeParse({}).success).toBe(false);
  });
});
