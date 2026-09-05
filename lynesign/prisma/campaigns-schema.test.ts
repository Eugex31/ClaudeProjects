import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
const schema = readFileSync("prisma/schema.prisma", "utf8");
it("Campaign, CampaignScreen, CampaignLocation exist", () => {
  expect(schema).toMatch(/model Campaign \{/);
  expect(schema).toMatch(/model CampaignScreen \{/);
  expect(schema).toMatch(/model CampaignLocation \{/);
  expect(schema).toMatch(/revision\s+Int\s+@default\(1\)/);
});
it("Campaign.playlist is onDelete Restrict", () => {
  const block = schema.match(/model Campaign \{[\s\S]*?\n\}/)![0];
  expect(block).toMatch(/playlist\s+Playlist\s+@relation\([^)]*onDelete:\s*Restrict/);
});
it("the join tables have their composite unique keys", () => {
  expect(schema).toMatch(/@@unique\(\[campaignId, screenId\]\)/);
  expect(schema).toMatch(/@@unique\(\[campaignId, locationId\]\)/);
});
