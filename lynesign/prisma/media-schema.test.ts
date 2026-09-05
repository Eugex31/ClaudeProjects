import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const s = readFileSync("prisma/schema.prisma", "utf8");
describe("media schema", () => {
  it("declares the models and enums", () => {
    for (const m of [
      "model MediaFolder",
      "model MediaAsset",
      "model MediaProcessingJob",
      "enum MediaKind",
      "enum MediaStatus",
    ]) {
      expect(s).toContain(m);
    }
  });
  it("MediaAsset is org-scoped, soft-deletable, and folder-linked", () => {
    const b = s.slice(s.indexOf("model MediaAsset"), s.indexOf("model MediaAsset") + 1400);
    expect(b).toMatch(/organizationId\s+String/);
    expect(b).toMatch(/archivedAt\s+DateTime\?/);
    expect(b).toMatch(/folderId\s+String\?/);
    expect(b).toMatch(/tags\s+String\[\]/);
  });
  it("Picture and Video link to MediaAsset", () => {
    expect(s).toMatch(/model Picture[\s\S]*mediaAssetId\s+String\?/);
    expect(s).toMatch(/model Video[\s\S]*mediaAssetId\s+String\?/);
  });
  it("MediaProcessingJob is global (no organizationId)", () => {
    const b = s.slice(s.indexOf("model MediaProcessingJob"), s.indexOf("model MediaProcessingJob") + 500);
    expect(b).not.toContain("organizationId");
  });
});
