/**
 * One-off: populate the carried content skeleton for "Costa Signage Co" so the
 * playback side of the product has data, covering canvas layouts, panels,
 * ordered frames (a de-facto playlist), typed media/web/weather content,
 * per-site targeting and canvas-to-screen assignment, plus ~30 days of activity
 * history that stands in for analytics.
 *
 * The Foundation build has no UI for any of this; view it in `npm run db:studio`
 * or through the player sync endpoint once that assembles content.
 *
 *   npx tsx scripts/simulate-content.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";

const FORCE = process.argv.includes("--force");
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000);
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);

// A stand-in "media library": named assets the Picture/Video frames point at.
const MEDIA = {
  fallPromo: "promo-fall-sale-1920x1080.jpg",
  brandSpot: "brand-spot-30s-1080p.mp4",
  specials: "downtown-specials-1920x1080.jpg",
  wayfindingA: "kiosk-wayfinding-a-1080x1920.jpg",
  wayfindingB: "kiosk-wayfinding-b-1080x1920.jpg",
  wayfindingC: "kiosk-directory-1080x1920.jpg",
  loyalty: "loyalty-signup-1920x1080.jpg",
  safety: "warehouse-safety-reminder-1920x1080.jpg",
};

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: "Costa Signage Co" } });
  if (!org) throw new Error("No organization named 'Costa Signage Co'.");

  const existing = await prisma.canvas.count({ where: { organizationId: org.id } });
  if (existing > 0 && !FORCE) {
    console.log(`Org already has ${existing} canvases. Pass --force to add more.`);
    return;
  }

  const locations = await prisma.location.findMany({ where: { organizationId: org.id } });
  const byName = (n: string) => locations.find((l) => l.name === n);
  const downtown = byName("Downtown Flagship");
  const mall = byName("Westfield Mall Unit 118");
  const airport = byName("Airport Kiosk T2");
  const warehouse = byName("Warehouse Breakroom");
  const popup = byName("Brooklyn Popup");

  const screens = await prisma.screen.findMany({ where: { organizationId: org.id } });
  const screen = (n: string) => screens.find((s) => s.name === n);

  const result = await withOrgTransaction(
    org.id,
    async (tx) => {
      // A frame + its typed content, in one helper.
      let frameSeq = 0;
      const addFrame = async (
        panelId: string,
        opts: {
          type:
            | "PICTURE"
            | "VIDEO"
            | "YOUTUBE"
            | "HTML"
            | "WEATHER"
            | "NEWS"
            | "CLOCK"
            | "MEMO";
          name: string;
          durationSeconds: number;
          locationIds?: string[];
          picture?: { mediaRef: string; mode?: string };
          video?: { mediaRef: string };
          youtube?: { videoId: string; aspect?: string };
          html?: { body: string; noScroll?: boolean };
          weather?: Record<string, never>;
          news?: { feedUrl: string };
          clock?: { label?: string; timeZone?: string };
          memo?: { body: string };
        },
      ) => {
        const frame = await tx.frame.create({
          data: {
            panelId,
            sortOrder: frameSeq++,
            durationSeconds: opts.durationSeconds,
            type: opts.type,
            locationScoped: (opts.locationIds?.length ?? 0) > 0,
          },
        });
        const content = await tx.content.create({
          data: { frameId: frame.id, name: opts.name },
        });
        const cid = { contentId: content.id };
        if (opts.picture)
          await tx.picture.create({ data: { ...cid, mediaRef: opts.picture.mediaRef, mode: opts.picture.mode ?? "fit" } });
        if (opts.video) await tx.video.create({ data: { ...cid, mediaRef: opts.video.mediaRef } });
        if (opts.youtube)
          await tx.youtube.create({ data: { ...cid, videoId: opts.youtube.videoId, aspect: opts.youtube.aspect ?? "16:9" } });
        if (opts.html) await tx.html.create({ data: { ...cid, body: opts.html.body } });
        if (opts.weather) await tx.weather.create({ data: { ...cid, type: 0, provider: 0 } });
        if (opts.news) await tx.news.create({ data: { ...cid, feedUrl: opts.news.feedUrl } });
        if (opts.clock)
          await tx.clock.create({ data: { ...cid, label: opts.clock.label ?? null, timeZone: opts.clock.timeZone ?? null } });
        if (opts.memo) await tx.memo.create({ data: { ...cid, body: opts.memo.body } });
        for (const locationId of opts.locationIds ?? []) {
          await tx.frameLocation.create({ data: { frameId: frame.id, locationId } });
        }
        return frame;
      };

      // ---- Canvas 1: Retail Storefront (landscape, main + ticker) ------
      const storefront = await tx.canvas.create({
        data: { name: "Retail Storefront", width: 1920, height: 1080, backgroundColor: "#0B1220" },
      });
      const sfMain = await tx.panel.create({
        data: { canvasId: storefront.id, name: "Main", x: 0, y: 0, width: 1920, height: 980, zIndex: 0 },
      });
      const sfTicker = await tx.panel.create({
        data: { canvasId: storefront.id, name: "Ticker", x: 0, y: 980, width: 1920, height: 100, zIndex: 1, noScroll: false },
      });
      frameSeq = 0;
      await addFrame(sfMain.id, { type: "PICTURE", name: "Fall promo", durationSeconds: 8, picture: { mediaRef: MEDIA.fallPromo } });
      await addFrame(sfMain.id, { type: "VIDEO", name: "Brand spot", durationSeconds: 30, video: { mediaRef: MEDIA.brandSpot } });
      await addFrame(sfMain.id, { type: "YOUTUBE", name: "Product demo", durationSeconds: 45, youtube: { videoId: "dQw4w9WgXcQ" } });
      await addFrame(sfMain.id, {
        type: "PICTURE",
        name: "Downtown specials (Downtown only)",
        durationSeconds: 10,
        picture: { mediaRef: MEDIA.specials },
        locationIds: downtown ? [downtown.id] : [],
      });
      await addFrame(sfMain.id, { type: "WEATHER", name: "Local weather", durationSeconds: 10, weather: {} });
      frameSeq = 0;
      await addFrame(sfTicker.id, {
        type: "HTML",
        name: "Headlines ticker",
        durationSeconds: 60,
        html: { body: "<marquee>Free shipping over $50  •  New fall collection in stores now  •  Join rewards and save 15%</marquee>" },
      });

      // ---- Canvas 2: Cafe Menu Board (landscape, static) --------------
      const menu = await tx.canvas.create({
        data: { name: "Cafe Menu Board", width: 1920, height: 1080, backgroundColor: "#1B2A45" },
      });
      const menuPanel = await tx.panel.create({
        data: { canvasId: menu.id, name: "Board", x: 0, y: 0, width: 1920, height: 1080, zIndex: 0, noScroll: true },
      });
      frameSeq = 0;
      await addFrame(menuPanel.id, {
        type: "HTML",
        name: "Menu",
        durationSeconds: 30,
        html: { body: "<h1>Menu</h1><ul><li>Drip coffee - 3.00</li><li>Latte - 4.50</li><li>Cold brew - 4.75</li><li>Croissant - 3.25</li></ul>", noScroll: true },
      });
      await addFrame(menuPanel.id, { type: "PICTURE", name: "Seasonal specials", durationSeconds: 12, picture: { mediaRef: MEDIA.specials } });

      // ---- Canvas 3: Kiosk Portrait (wayfinding) ---------------------
      const kiosk = await tx.canvas.create({
        data: { name: "Kiosk Portrait", width: 1080, height: 1920, backgroundColor: "#000000" },
      });
      const kioskPanel = await tx.panel.create({
        data: { canvasId: kiosk.id, name: "Full", x: 0, y: 0, width: 1080, height: 1920, zIndex: 0 },
      });
      frameSeq = 0;
      await addFrame(kioskPanel.id, { type: "PICTURE", name: "Wayfinding A", durationSeconds: 12, picture: { mediaRef: MEDIA.wayfindingA } });
      await addFrame(kioskPanel.id, { type: "PICTURE", name: "Wayfinding B", durationSeconds: 12, picture: { mediaRef: MEDIA.wayfindingB } });
      await addFrame(kioskPanel.id, { type: "PICTURE", name: "Directory", durationSeconds: 15, picture: { mediaRef: MEDIA.wayfindingC } });
      await addFrame(kioskPanel.id, { type: "PICTURE", name: "Loyalty signup", durationSeconds: 10, picture: { mediaRef: MEDIA.loyalty } });

      // ---- Canvas 4: Breakroom Info --------------------------------
      const breakroom = await tx.canvas.create({
        data: { name: "Breakroom Info", width: 1920, height: 1080, backgroundColor: "#16223A" },
      });
      const brMain = await tx.panel.create({
        data: { canvasId: breakroom.id, name: "Main", x: 0, y: 0, width: 1440, height: 1080, zIndex: 0 },
      });
      const brSide = await tx.panel.create({
        data: { canvasId: breakroom.id, name: "Side", x: 1440, y: 0, width: 480, height: 1080, zIndex: 1 },
      });
      frameSeq = 0;
      await addFrame(brMain.id, { type: "NEWS", name: "Company news", durationSeconds: 30, news: { feedUrl: "https://example.com/costa/feed.xml" } });
      await addFrame(brMain.id, { type: "MEMO", name: "All-hands notice", durationSeconds: 15, memo: { body: "All-hands Friday 3pm in the main hall. Remote link in your calendar." } });
      await addFrame(brMain.id, { type: "PICTURE", name: "Safety reminder", durationSeconds: 12, picture: { mediaRef: MEDIA.safety } });
      frameSeq = 0;
      await addFrame(brSide.id, { type: "CLOCK", name: "Clock", durationSeconds: 60, clock: { label: "Chicago", timeZone: "America/Chicago" } });
      await addFrame(brSide.id, { type: "WEATHER", name: "Weather", durationSeconds: 30, weather: {} });

      // ---- Assign canvases to screens -----------------------------
      const assign = async (canvasId: string, names: string[]) => {
        for (const n of names) {
          const s = screen(n);
          if (s) await tx.screen.update({ where: { id: s.id }, data: { canvasId } });
        }
      };
      await assign(storefront.id, ["Window Display North", "Window Display South", "Storefront LED Wall", "Popup Entrance", "Popup Back Wall"]);
      await assign(menu.id, ["Cafe Menu Board", "Checkout Overhead"]);
      await assign(kiosk.id, ["Kiosk Portrait A", "Kiosk Portrait B", "Fitting Room Hallway"]);
      await assign(breakroom.id, ["Breakroom TV", "Loading Dock Notice", "Loading Dock Notice"]);

      const [canvases, panels, frames, contents, frameLocations, assigned] = await Promise.all([
        tx.canvas.count(),
        tx.panel.count(),
        tx.frame.count(),
        tx.content.count(),
        tx.frameLocation.count(),
        tx.screen.count({ where: { canvasId: { not: null } } }),
      ]);
      return { canvases, panels, frames, contents, frameLocations, screensWithCanvas: assigned };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  // ---- Analytics stand-in: ~30 days of screen + content activity ----
  const actions = [
    "screen.pair",
    "screen.online",
    "screen.offline",
    "screen.offline.sweep",
    "content.assign",
    "canvas.update",
    "screen.reload",
  ];
  const owner = await prisma.membership.findFirst({ where: { organizationId: org.id, role: "OWNER" } });
  const events: { action: string; targetType: string; when: Date }[] = [];
  for (let d = 30; d >= 0; d--) {
    const perDay = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < perDay; i++) {
      const a = actions[Math.floor(Math.random() * actions.length)];
      const when = Math.min(
        daysAgo(d).getTime() + Math.floor(Math.random() * 12) * 3_600_000,
        now - 60_000,
      );
      events.push({
        action: a,
        targetType: a.startsWith("canvas") ? "Canvas" : a.startsWith("content") ? "Content" : "Screen",
        when: new Date(when),
      });
    }
  }
  for (const e of events) {
    const row = await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorType: e.action.includes("sweep") ? "SYSTEM" : "USER",
        actorId: e.action.includes("sweep") ? null : owner?.userId ?? null,
        action: e.action,
        targetType: e.targetType,
        metadata: { simulated: true },
      },
    });
    await prisma.auditLog.update({ where: { id: row.id }, data: { createdAt: e.when } });
  }

  console.log("\nContent skeleton for Costa Signage Co");
  console.table(result);
  console.log(`\nMedia assets referenced: ${Object.keys(MEDIA).length}`);
  console.log(`Activity/analytics events written: ${events.length} across 30 days`);
  console.log(`Recent-activity feed now spans ~${Math.round(events.length / 30 * 30)} entries; view content in: npm run db:studio`);
  void hoursAgo;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
