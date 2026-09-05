import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("hierarchy + content skeleton", () => {
  it("Location self-references for the tree", () => {
    expect(schema).toMatch(/parentId\s+String\?/);
    expect(schema).toMatch(/parent\s+Location\?\s+@relation/);
  });
  it("Screen has the status enum and pairing fields", () => {
    expect(schema).toContain("enum ScreenStatus");
    expect(schema).toMatch(/pairingCode\s+String\?/);
    expect(schema).toMatch(/deviceTokenHash\s+String\?/);
  });
  it("content tables carry a denormalized organizationId", () => {
    const block = schema.slice(schema.indexOf("model Panel"), schema.indexOf("model Panel") + 400);
    expect(block).toContain("organizationId");
  });
  it("migrated tables carry legacyId", () => {
    expect((schema.match(/legacyId\s+Int\?\s+@unique/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
