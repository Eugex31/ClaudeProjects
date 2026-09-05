import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/db/root";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const block = (name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))![0];

describe("canvas editor schema", () => {
  it("Canvas has revision and archivedAt", () => {
    const b = block("Canvas");
    expect(b).toMatch(/revision\s+Int\s+@default\(1\)/);
    expect(b).toMatch(/archivedAt\s+DateTime\?/);
  });

  it("Canvas has the organizationId + archivedAt index", () => {
    expect(block("Canvas")).toMatch(/@@index\(\[organizationId, archivedAt\]\)/);
  });

  it("Canvas.backgroundImage is a SetNull FK to MediaAsset", () => {
    expect(block("Canvas")).toMatch(
      /backgroundImage\s+MediaAsset\?\s+@relation\([^)]*onDelete:\s*SetNull/,
    );
  });

  it("MediaAsset back-relates canvasBackgrounds", () => {
    expect(block("MediaAsset")).toMatch(
      /canvasBackgrounds\s+Canvas\[\]\s+@relation\("CanvasBackground"\)/,
    );
  });

  it("FrameType has WEB", () => {
    expect(schema).toMatch(/enum FrameType \{[\s\S]*\bWEB\b[\s\S]*\}/);
  });

  it("Web model exists with url and cascade", () => {
    const b = block("Web");
    expect(b).toMatch(/url\s+String/);
    expect(b).toMatch(/content\s+Content\s+@relation\([^)]*onDelete:\s*Cascade/);
  });

  it("Content back-relates web", () => {
    expect(block("Content")).toMatch(/web\s+Web\?/);
  });
});

const slug = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("canvas editor FK and enum behaviour (live dev DB)", () => {
  let orgId: string;
  let canvasId: string;
  let panelId: string;
  let mediaAssetId: string;

  afterEach(async () => {
    if (orgId) {
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    orgId = "";
  });

  async function seed() {
    const org = await prisma.organization.create({
      data: { name: "canvas-test", slug: slug("canvas") },
    });
    orgId = org.id;
    const canvas = await prisma.canvas.create({
      data: { organizationId: orgId, name: "cv", width: 1920, height: 1080 },
    });
    canvasId = canvas.id;
    const panel = await prisma.panel.create({
      data: {
        organizationId: orgId,
        canvasId,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    });
    panelId = panel.id;
    const asset = await prisma.mediaAsset.create({
      data: { organizationId: orgId, kind: "IMAGE", name: "bg" },
    });
    mediaAssetId = asset.id;
  }

  it("creates a Frame with type WEB", async () => {
    await seed();
    const frame = await prisma.frame.create({
      data: { organizationId: orgId, panelId, type: "WEB" },
    });
    expect(frame.type).toBe("WEB");
  });

  it("cascades a Web row away when its Content is deleted", async () => {
    await seed();
    const frame = await prisma.frame.create({
      data: { organizationId: orgId, panelId, type: "WEB" },
    });
    const content = await prisma.content.create({
      data: { organizationId: orgId, frameId: frame.id },
    });
    await prisma.web.create({
      data: {
        contentId: content.id,
        organizationId: orgId,
        url: "https://example.com",
      },
    });

    await prisma.content.delete({ where: { id: content.id } });

    const after = await prisma.web.findUnique({ where: { contentId: content.id } });
    expect(after).toBeNull();
  });

  it("nulls Canvas.backgroundImageId when the MediaAsset is deleted, keeping the canvas", async () => {
    await seed();
    await prisma.canvas.update({
      where: { id: canvasId },
      data: { backgroundImageId: mediaAssetId },
    });

    await prisma.mediaAsset.delete({ where: { id: mediaAssetId } });

    const after = await prisma.canvas.findUnique({ where: { id: canvasId } });
    expect(after).not.toBeNull();
    expect(after?.backgroundImageId).toBeNull();
  });
});
