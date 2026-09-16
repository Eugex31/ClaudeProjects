/**
 * One-off: populate the "Costa Signage Co" media library with a realistic mix
 * of folders and assets so the /media page looks lived-in.
 *
 * Real image bytes and thumbnails are written to the local MinIO bucket (start
 * it first with `npm run storage:up`), so image cards render actual thumbnails.
 * Video assets get a small stub object plus a realistic `sizeBytes` on the row
 * so the storage bar reads as a signage network would; the stub will not play
 * in the preview dialog, which is fine for a demo.
 *
 * Re-run safe: exits if the org already has media assets unless --force is
 * passed (which adds another batch alongside the existing ones).
 *
 *   npm run storage:up
 *   npx tsx scripts/simulate-media.ts [--force]
 */
import { createHash } from "node:crypto";

import sharp from "sharp";

import { prisma } from "@/lib/db/root";
import { storage, assetStorageKey, assetThumbKey } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000);
const MB = 1024 * 1024;
const GB = 1024 * MB;

type FolderSpec = { key: string; name: string; parent?: string };
type AssetSpec = {
  name: string;
  kind: "IMAGE" | "VIDEO" | "WEB";
  folder?: string;
  tags: string[];
  hue: number;
  createdDaysAgo: number;
  by: "owner" | "maria";
  sizeBytes: number;
  durationSeconds?: number;
  url?: string;
  archived?: boolean;
};

const FOLDERS: FolderSpec[] = [
  { key: "brand", name: "Brand Assets" },
  { key: "logos", name: "Logos", parent: "brand" },
  { key: "promos", name: "Promotions" },
  { key: "menus", name: "Menu Boards" },
  { key: "seasonal", name: "Seasonal" },
];

const ASSETS: AssetSpec[] = [
  { name: "Primary Logo", kind: "IMAGE", folder: "logos", tags: ["brand", "logo"], hue: 210, createdDaysAgo: 28, by: "owner", sizeBytes: 3 * MB },
  { name: "Logo Monochrome", kind: "IMAGE", folder: "logos", tags: ["brand", "logo", "mono"], hue: 0, createdDaysAgo: 28, by: "owner", sizeBytes: 2 * MB },
  { name: "Brand Guidelines Cover", kind: "IMAGE", folder: "brand", tags: ["brand", "guidelines"], hue: 265, createdDaysAgo: 25, by: "owner", sizeBytes: 5 * MB },
  { name: "Summer Sale Hero", kind: "IMAGE", folder: "promos", tags: ["promo", "summer", "sale"], hue: 32, createdDaysAgo: 19, by: "maria", sizeBytes: 7 * MB },
  { name: "Buy One Get One", kind: "IMAGE", folder: "promos", tags: ["promo", "bogo"], hue: 145, createdDaysAgo: 17, by: "maria", sizeBytes: 6 * MB },
  { name: "Flash Sale 24h", kind: "IMAGE", folder: "promos", tags: ["promo", "flash"], hue: 350, createdDaysAgo: 12, by: "maria", sizeBytes: 4 * MB, archived: true },
  { name: "Promo Sizzle Reel", kind: "VIDEO", folder: "promos", tags: ["promo", "video"], hue: 20, createdDaysAgo: 16, by: "owner", sizeBytes: Math.round(2.4 * GB), durationSeconds: 32 },
  { name: "Breakfast Menu Board", kind: "IMAGE", folder: "menus", tags: ["menu", "breakfast"], hue: 45, createdDaysAgo: 22, by: "owner", sizeBytes: 5 * MB },
  { name: "Lunch Menu Board", kind: "IMAGE", folder: "menus", tags: ["menu", "lunch"], hue: 95, createdDaysAgo: 22, by: "owner", sizeBytes: 5 * MB },
  { name: "Dinner Menu Board", kind: "IMAGE", folder: "menus", tags: ["menu", "dinner"], hue: 230, createdDaysAgo: 22, by: "owner", sizeBytes: 5 * MB },
  { name: "Menu Motion Background", kind: "VIDEO", folder: "menus", tags: ["menu", "video", "loop"], hue: 190, createdDaysAgo: 21, by: "owner", sizeBytes: Math.round(3.1 * GB), durationSeconds: 45 },
  { name: "Fall Campaign Key Art", kind: "IMAGE", folder: "seasonal", tags: ["seasonal", "fall"], hue: 28, createdDaysAgo: 9, by: "maria", sizeBytes: 8 * MB },
  { name: "Holiday Ambient Loop", kind: "VIDEO", folder: "seasonal", tags: ["seasonal", "holiday", "video"], hue: 350, createdDaysAgo: 6, by: "maria", sizeBytes: Math.round(11.5 * GB), durationSeconds: 600 },
  { name: "Storefront LED Wall Content", kind: "VIDEO", folder: "seasonal", tags: ["seasonal", "led", "video"], hue: 300, createdDaysAgo: 4, by: "owner", sizeBytes: Math.round(4.2 * GB), durationSeconds: 120 },
  { name: "Company Website", kind: "WEB", tags: ["web", "corporate"], hue: 210, createdDaysAgo: 15, by: "owner", sizeBytes: 0, url: "https://example.com" },
  { name: "Local Weather Board", kind: "WEB", tags: ["web", "weather"], hue: 200, createdDaysAgo: 8, by: "maria", sizeBytes: 0, url: "https://example.com/weather" },
];

/** A distinct, no-font placeholder image: hued background plus two soft circles. */
async function makeImage(hue: number): Promise<Buffer> {
  const w = 1280;
  const h = 720;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 42%)"/>
    <circle cx="${w * 0.28}" cy="${h * 0.34}" r="${h * 0.42}" fill="hsl(${(hue + 24) % 360} 60% 55%)" fill-opacity="0.55"/>
    <circle cx="${w * 0.74}" cy="${h * 0.7}" r="${h * 0.5}" fill="hsl(${(hue + 330) % 360} 45% 30%)" fill-opacity="0.5"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) throw new Error(`No organization named "${ORG_NAME}". Register it first at /register.`);

  const owner = await prisma.membership.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
  });
  const maria = await prisma.user.findFirst({ where: { email: "maria@costasignage.test" } });
  const byId = { owner: owner?.userId ?? null, maria: maria?.id ?? owner?.userId ?? null };

  const existing = await prisma.mediaAsset.count({ where: { organizationId: org.id } });
  if (existing > 0 && !FORCE) {
    console.log(`Org already has ${existing} media assets. Pass --force to add another batch.`);
    return;
  }

  // ---- Folders (parents first) ----------------------------------------
  const folderId: Record<string, string> = {};
  for (const f of FOLDERS) {
    const row = await prisma.mediaFolder.create({
      data: {
        organizationId: org.id,
        name: f.name,
        parentId: f.parent ? folderId[f.parent] : null,
      },
    });
    folderId[f.key] = row.id;
  }

  // ---- Assets --------------------------------------------------------
  let images = 0;
  let videos = 0;
  let webs = 0;
  let bytes = 0;

  for (const spec of ASSETS) {
    const created = daysAgo(spec.createdDaysAgo);
    const asset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        folderId: spec.folder ? folderId[spec.folder] : null,
        kind: spec.kind,
        status: "READY",
        name: spec.name,
        tags: spec.tags,
        sizeBytes: BigInt(spec.sizeBytes),
        durationSeconds: spec.durationSeconds ?? null,
        url: spec.url ?? null,
        createdByUserId: byId[spec.by],
        createdAt: created,
        archivedAt: spec.archived ? daysAgo(Math.max(1, spec.createdDaysAgo - 3)) : null,
      },
    });

    if (spec.kind === "IMAGE") {
      const original = await makeImage(spec.hue);
      const meta = await sharp(original).metadata();
      const thumb = await sharp(original).resize(480, 480, { fit: "inside" }).webp().toBuffer();
      const key = assetStorageKey(org.id, asset.id, ".png");
      const thumbKey = assetThumbKey(org.id, asset.id);
      await storage.putObject(key, original, "image/png");
      await storage.putObject(thumbKey, thumb, "image/webp");
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          originalFilename: `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
          mimeType: "image/png",
          storageKey: key,
          thumbnailKey: thumbKey,
          checksum: createHash("sha256").update(original).digest("hex"),
          width: meta.width ?? 1280,
          height: meta.height ?? 720,
        },
      });
      images += 1;
      bytes += spec.sizeBytes;
    } else if (spec.kind === "VIDEO") {
      const key = assetStorageKey(org.id, asset.id, ".mp4");
      const stub = Buffer.from("stub video object for the media demo");
      await storage.putObject(key, stub, "video/mp4");
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          originalFilename: `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`,
          mimeType: "video/mp4",
          storageKey: key,
          checksum: createHash("sha256").update(stub).digest("hex"),
          width: 3840,
          height: 2160,
        },
      });
      videos += 1;
      bytes += spec.sizeBytes;
    } else {
      webs += 1;
    }

    await writeAudit({
      organizationId: org.id,
      actorType: "USER",
      actorId: byId[spec.by] ?? undefined,
      action: spec.kind === "WEB" ? "media.web.create" : "media.upload",
      targetType: "MediaAsset",
      targetId: asset.id,
      metadata: { simulated: true, name: spec.name },
    });
  }

  console.log(`\nMedia simulation complete for ${ORG_NAME}`);
  console.table({
    folders: FOLDERS.length,
    images,
    videos,
    web: webs,
    archived: ASSETS.filter((a) => a.archived).length,
    storageUsed: `${(bytes / GB).toFixed(1)} GB of 107.4 GB`,
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
