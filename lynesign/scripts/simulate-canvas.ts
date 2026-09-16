/**
 * One-off: give "Costa Signage Co" two hand-authored canvases so the visual
 * canvas editor, the canvas preview route and the player sync canvas tier all
 * have something real to render.
 *
 *   - "Lobby Board" 1920x1080: a full-bleed media panel that rotates three
 *     storefront images at eight seconds each, a top-right clock panel in the
 *     digital compact style (Clock.type 1), a bottom memo strip, and a small web
 *     panel in the top-left corner. The panels stack by zIndex so the clock,
 *     memo and web sit above the full-bleed image.
 *   - "Portrait Menu" 1080x1920: two stacked media panels, top half and bottom
 *     half, each showing one image.
 *
 * The screen named "Storefront LED Wall" is switched into canvas mode and
 * pointed at "Lobby Board". The pointer is written straight through the tenant
 * transaction, the same way simulate-schedule.ts writes its join rows rather
 * than calling the gated setScreenContentSource action; setting canvasId clears
 * playlistId so the two stay mutually exclusive.
 *
 * Every row is left to Prisma's own `@default(cuid())`. The server actions all
 * validate ids as cuids, so a seeded canvas carrying a readable slug id would
 * render but reject every edit made to it in the editor. Idempotency instead
 * comes from a natural key, the way simulate-schedule.ts does it: a canvas is
 * matched by organization and name, an existing one is skipped, and --force
 * deletes it (panels, frames and content cascade) and rebuilds it fresh. A new
 * canvas is born at revision 1, so there is no revision work here.
 *
 * Re-run safe: a second plain run skips every canvas that already exists.
 *
 *   npm run db:up
 *   npm run storage:up
 *   npx tsx scripts/simulate-canvas.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

const STOREFRONT_SCREEN_NAME = "Storefront LED Wall";
const LOBBY_CANVAS_NAME = "Lobby Board";

type FrameSpec =
  | { kind: "image"; assetId: string; durationSeconds: number }
  | { kind: "clock"; style: number; durationSeconds: number }
  | { kind: "memo"; body: string; durationSeconds: number }
  | { kind: "web"; url: string; durationSeconds: number };

interface PanelSpec {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  frames: FrameSpec[];
}

interface CanvasSpec {
  name: string;
  width: number;
  height: number;
  panels: PanelSpec[];
}

const FRAME_TYPE: Record<FrameSpec["kind"], "PICTURE" | "CLOCK" | "MEMO" | "WEB"> = {
  image: "PICTURE",
  clock: "CLOCK",
  memo: "MEMO",
  web: "WEB",
};

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    throw new Error(
      `No organization named "${ORG_NAME}". Run scripts/simulate-account.ts first.`,
    );
  }

  const images = await prisma.mediaAsset.findMany({
    where: {
      organizationId: org.id,
      kind: "IMAGE",
      status: "READY",
      archivedAt: null,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (images.length < 3) {
    throw new Error(
      `Need at least three ready image assets in "${ORG_NAME}". Run scripts/simulate-media.ts first.`,
    );
  }
  const pick = images.slice(0, 3);

  const specs: CanvasSpec[] = [
    {
      name: LOBBY_CANVAS_NAME,
      width: 1920,
      height: 1080,
      panels: [
        {
          name: "Full bleed",
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          zIndex: 0,
          frames: pick.map((asset) => ({
            kind: "image" as const,
            assetId: asset.id,
            durationSeconds: 8,
          })),
        },
        {
          name: "Clock",
          x: 1560,
          y: 40,
          width: 320,
          height: 160,
          zIndex: 30,
          frames: [{ kind: "clock", style: 1, durationSeconds: 10 }],
        },
        {
          name: "Memo",
          x: 0,
          y: 920,
          width: 1920,
          height: 160,
          zIndex: 10,
          frames: [
            { kind: "memo", body: "Welcome to Costa Signage", durationSeconds: 10 },
          ],
        },
        {
          name: "Web",
          x: 40,
          y: 40,
          width: 400,
          height: 240,
          zIndex: 20,
          frames: [
            { kind: "web", url: "https://example.com", durationSeconds: 10 },
          ],
        },
      ],
    },
    {
      name: "Portrait Menu",
      width: 1080,
      height: 1920,
      panels: [
        {
          name: "Top half",
          x: 0,
          y: 0,
          width: 1080,
          height: 960,
          zIndex: 0,
          frames: [
            { kind: "image", assetId: pick[0].id, durationSeconds: 10 },
          ],
        },
        {
          name: "Bottom half",
          x: 0,
          y: 960,
          width: 1080,
          height: 960,
          zIndex: 0,
          frames: [
            { kind: "image", assetId: pick[1].id, durationSeconds: 10 },
          ],
        },
      ],
    },
  ];

  const canvasIds = new Map<string, string>();
  const built: string[] = [];
  const skipped: string[] = [];

  for (const spec of specs) {
    const existing = await prisma.canvas.findFirst({
      where: { organizationId: org.id, name: spec.name },
      select: { id: true },
    });

    if (existing && !FORCE) {
      canvasIds.set(spec.name, existing.id);
      skipped.push(spec.name);
      continue;
    }

    const canvasId = await withOrgTransaction(
      org.id,
      async (tx) => {
        if (existing) {
          // Panels, frames, content and the typed rows all cascade from Canvas,
          // and Screen.canvasId is SetNull, so this clears the whole subtree
          // without stranding anything. The screen is re-pointed below.
          await tx.canvas.delete({ where: { id: existing.id } });
        }

        const canvas = await tx.canvas.create({
          data: {
            organizationId: org.id,
            name: spec.name,
            width: spec.width,
            height: spec.height,
          },
        });

        for (const panel of spec.panels) {
          const panelRow = await tx.panel.create({
            data: {
              organizationId: org.id,
              canvasId: canvas.id,
              name: panel.name,
              x: panel.x,
              y: panel.y,
              width: panel.width,
              height: panel.height,
              zIndex: panel.zIndex,
            },
          });

          for (let f = 0; f < panel.frames.length; f += 1) {
            const frame = panel.frames[f];
            const frameRow = await tx.frame.create({
              data: {
                organizationId: org.id,
                panelId: panelRow.id,
                sortOrder: f,
                durationSeconds: frame.durationSeconds,
                type: FRAME_TYPE[frame.kind],
              },
            });

            const content = await tx.content.create({
              data: { organizationId: org.id, frameId: frameRow.id },
            });
            const contentId = content.id;

            if (frame.kind === "image") {
              await tx.picture.create({
                data: {
                  contentId,
                  organizationId: org.id,
                  mediaAssetId: frame.assetId,
                  mode: "cover",
                },
              });
            } else if (frame.kind === "clock") {
              await tx.clock.create({
                data: {
                  contentId,
                  organizationId: org.id,
                  type: frame.style,
                  showDate: true,
                  showTime: true,
                  showSeconds: true,
                },
              });
            } else if (frame.kind === "memo") {
              await tx.memo.create({
                data: { contentId, organizationId: org.id, body: frame.body },
              });
            } else {
              await tx.web.create({
                data: { contentId, organizationId: org.id, url: frame.url },
              });
            }
          }
        }

        return canvas.id;
      },
      { timeout: 30000 },
    );

    canvasIds.set(spec.name, canvasId);
    built.push(spec.name);
  }

  if (skipped.length > 0 && built.length === 0) {
    console.log(
      `Every canvas already exists (${skipped.join(", ")}). Pass --force to rebuild them.`,
    );
  }

  const lobbyId = canvasIds.get(LOBBY_CANVAS_NAME);
  if (!lobbyId) {
    throw new Error(`Could not resolve the "${LOBBY_CANVAS_NAME}" canvas.`);
  }

  // Switch a storefront screen into canvas mode, pointed at "Lobby Board".
  const storefrontScreens = await prisma.screen.findMany({
    where: { organizationId: org.id, name: { startsWith: "Storefront" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const exact = storefrontScreens.find((s) => s.name === STOREFRONT_SCREEN_NAME);
  const target = exact ?? storefrontScreens[0] ?? null;
  if (!target) {
    throw new Error(
      `No screen whose name starts with "Storefront" in "${ORG_NAME}". Run scripts/simulate-account.ts first.`,
    );
  }

  await withOrgTransaction(org.id, async (tx) => {
    await tx.screen.update({
      where: { id: target.id },
      data: { canvasId: lobbyId, playlistId: null },
    });
  });

  const ids = [...canvasIds.values()];
  const panelCount = await prisma.panel.count({
    where: { canvasId: { in: ids } },
  });
  const frameCount = await prisma.frame.count({
    where: { panel: { canvasId: { in: ids } } },
  });

  console.log(`\nCanvas simulation complete for ${ORG_NAME}`);
  console.table(
    specs.map((canvas) => ({
      canvas: canvas.name,
      size: `${canvas.width} x ${canvas.height}`,
      panels: canvas.panels.length,
      frames: canvas.panels.reduce((sum, p) => sum + p.frames.length, 0),
      state: built.includes(canvas.name) ? "built" : "skipped",
    })),
  );
  console.table({
    canvases: specs.length,
    panels: panelCount,
    frames: frameCount,
    screensSwitched: 1,
  });
  console.log(
    `Screen switched to canvas mode: ${target.name}` +
      (exact ? "." : ` (no screen named "${STOREFRONT_SCREEN_NAME}"; used the first storefront screen).`),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
