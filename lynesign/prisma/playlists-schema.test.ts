import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("playlists schema", () => {
  it("Playlist and PlaylistItem exist and are tenant-scoped", () => {
    expect(schema).toMatch(/model Playlist \{/);
    expect(schema).toMatch(/model PlaylistItem \{/);
    expect(schema).toMatch(/revision\s+Int\s+@default\(1\)/);
  });

  it("PlaylistItem.mediaAsset is onDelete Restrict", () => {
    const block = schema.match(/model PlaylistItem \{[\s\S]*?\n\}/)![0];
    expect(block).toMatch(/mediaAsset\s+MediaAsset\s+@relation\([^)]*onDelete:\s*Restrict/);
  });

  it("Screen has a nullable playlistId with SetNull", () => {
    const block = schema.match(/model Screen \{[\s\S]*?\n\}/)![0];
    expect(block).toMatch(/playlistId\s+String\?/);
    expect(block).toMatch(/onDelete:\s*SetNull/);
  });
});
