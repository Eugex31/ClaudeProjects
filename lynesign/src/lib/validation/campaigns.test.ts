import { it, expect } from "vitest";
import { createCampaignSchema, updateCampaignSchema, setTargetsSchema } from "@/lib/validation/campaigns";

const base = {
  name: "Fall Sale",
  playlistId: "pl1",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-15T00:00:00.000Z",
};
it("createCampaignSchema accepts a valid window and rejects a reversed one", () => {
  expect(createCampaignSchema.safeParse(base).success).toBe(true);
  expect(createCampaignSchema.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
  expect(createCampaignSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
});
it("priority is bounded 0..1000", () => {
  expect(createCampaignSchema.safeParse({ ...base, priority: -1 }).success).toBe(false);
  expect(createCampaignSchema.safeParse({ ...base, priority: 1001 }).success).toBe(false);
  expect(createCampaignSchema.safeParse({ ...base, priority: 10 }).success).toBe(true);
});
it("bad ISO datetime is rejected", () => {
  expect(createCampaignSchema.safeParse({ ...base, startsAt: "next tuesday" }).success).toBe(false);
});
it("updateCampaignSchema rejects a reversed window only when both are present", () => {
  expect(updateCampaignSchema.safeParse({ name: "x" }).success).toBe(true);
  expect(updateCampaignSchema.safeParse({ startsAt: base.endsAt, endsAt: base.startsAt }).success).toBe(false);
  expect(updateCampaignSchema.safeParse({ endsAt: base.endsAt }).success).toBe(true);
});
it("setTargetsSchema needs at least one target and caps the arrays", () => {
  expect(setTargetsSchema.safeParse({ screenIds: [], locationIds: [] }).success).toBe(false);
  expect(setTargetsSchema.safeParse({ screenIds: ["s1"], locationIds: [] }).success).toBe(true);
  expect(setTargetsSchema.safeParse({ screenIds: Array(1001).fill("s"), locationIds: [] }).success).toBe(false);
});
