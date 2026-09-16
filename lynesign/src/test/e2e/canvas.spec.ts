import path from "node:path";
import { readFileSync } from "node:fs";

import { test, expect } from "@playwright/test";

import { prisma } from "@/lib/db/root";
import { hashPassword } from "@/lib/auth/password";
import { storage, assetStorageKey } from "@/lib/storage";
import { resetDb, seedPlans } from "../helpers/db";

/**
 * The visual canvas journey, end to end against a production build:
 *
 *   sign in as a seeded owner -> open /canvas and create a 1920x1080 canvas from
 *   the New canvas dialog, landing in the editor -> add a panel, drag it, and
 *   assert its rendered left is grid-aligned so snapping ran -> add an Image
 *   frame and point it at the seeded library image -> go to /screens, switch the
 *   seeded screen's content source to that canvas -> pair the screen and
 *   GET /api/player/sync, asserting the screen now serves the canvas manifest:
 *   source "canvas", one panel, one image frame with a signed url, and a null
 *   playlist.
 *
 * The org, owner, location, screen and library image are written straight
 * through `@/lib/db/root`: the other e2e suites already cover registration and
 * screen creation from their pages, and this suite needs a known password to
 * sign in with. Everything the canvas editor and the screen content-source
 * dialog do is driven from the UI.
 *
 * Selectors are role- and label-based. The two structural hooks the drag step
 * relies on, `data-testid="canvas-stage"` on the stage box and `data-panel-id`
 * on each panel, already exist in the Task 11 to 14 components; this spec adds
 * no new test ids. The suite owns its data: it truncates every table and
 * reseeds the plans once before the run.
 */

const SAMPLE_PNG = path.join(__dirname, "../fixtures/sample.png");
const PAIRING_CODE = "E2ECANV1";
const PASSWORD = "correct-horse-battery-staple";
const GRID = 8;

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("sign in, author a canvas, point a screen at it, and sync it to a player", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const email = `canvas-${stamp}@example.com`;
  const orgName = `Canvas Co ${stamp}`;
  const CANVAS_NAME = `Lobby ${stamp}`;

  // --- Seed the org, owner, location, screen and one ready image ------------
  const org = await prisma.organization.create({
    data: { name: orgName, slug: `canvas-co-${stamp}` },
  });
  const user = await prisma.user.create({
    data: {
      name: "Canvas Owner",
      email,
      hashedPassword: await hashPassword(PASSWORD),
      emailVerified: new Date(),
    },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  // The other e2e suites get a TRIAL subscription through registration; this one
  // seeds the org directly, so add the same row rather than relying on the app
  // never needing a plan on the canvas path.
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "TRIAL" },
  });

  const location = await prisma.location.create({
    data: { organizationId: org.id, name: "Canvas Site" },
  });
  const screen = await prisma.screen.create({
    data: {
      organizationId: org.id,
      locationId: location.id,
      name: "Canvas Screen",
      status: "UNPAIRED",
      pairingCode: PAIRING_CODE,
    },
  });

  const png = readFileSync(SAMPLE_PNG);
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: org.id,
      kind: "IMAGE",
      status: "READY",
      name: "Lobby Hero",
      mimeType: "image/png",
      width: 1,
      height: 1,
      sizeBytes: BigInt(png.length),
    },
  });
  const assetKey = assetStorageKey(org.id, asset.id, ".png");
  await storage.putObject(assetKey, png, "image/png");
  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { storageKey: assetKey },
  });

  // --- Sign in -------------------------------------------------------------
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");

  // --- Create a 1920x1080 canvas from the New canvas dialog --------------
  await page.goto("/canvas");
  await page.getByRole("button", { name: "New canvas" }).first().click();
  const newDialog = page.getByRole("dialog");
  await expect(
    newDialog.getByRole("heading", { name: "New canvas" }),
  ).toBeVisible();
  await newDialog.getByLabel("Name", { exact: true }).fill(CANVAS_NAME);
  // The "Landscape 1920 x 1080" preset is selected by default.
  await newDialog.getByRole("button", { name: "Create canvas" }).click();

  // The action redirects into the editor for the new canvas.
  await page.waitForURL("**/canvas/**");
  await expect(
    page.getByRole("heading", { name: CANVAS_NAME }),
  ).toBeVisible();

  const canvasId = new URL(page.url()).pathname.split("/").pop()!;
  expect(canvasId).toBeTruthy();

  // --- Add a panel and drag it: snapping keeps the left on the grid -----
  await page.getByRole("button", { name: "Add panel" }).click();
  const panel = page.locator("[data-panel-id]").first();
  await expect(panel).toBeVisible();

  const stageBox = await page.getByTestId("canvas-stage").boundingBox();
  const panelBox = await panel.boundingBox();
  if (!stageBox || !panelBox) throw new Error("Stage or panel has no box.");
  const scale = stageBox.width / 1920;

  // Move the panel roughly 256 x 168 canvas pixels down and to the right, well
  // clear of the canvas edges and centre lines so no alignment guide steals the
  // drop off the 8px grid.
  const from = {
    x: panelBox.x + panelBox.width / 2,
    y: panelBox.y + panelBox.height / 2,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 256 * scale, from.y + 168 * scale, { steps: 12 });
  await page.mouse.up();

  const leftPx = await panel.evaluate(
    (el) => Number.parseFloat((el as HTMLElement).style.left),
  );
  const canvasX = leftPx / scale;
  expect(Math.abs(canvasX - Math.round(canvasX))).toBeLessThan(1);
  expect(Math.round(canvasX) % GRID).toBe(0);
  expect(Math.round(canvasX)).toBeGreaterThan(GRID);

  await expect
    .poll(async () => {
      const rows = await prisma.panel.findMany({
        where: { canvasId },
        select: { x: true },
      });
      return rows.length === 1 ? rows[0].x % GRID : null;
    })
    .toBe(0);

  // --- Add an Image frame and point it at the seeded library image -----
  await page.getByRole("button", { name: "Add frame" }).click();
  await page.getByRole("menuitem", { name: "Image" }).click();

  // The frame content editor mounts only after createFrame's router.refresh()
  // lands a new tree and the editor adopts it; wait for that explicitly rather
  // than leaning on auto-wait through the whole chain.
  await expect(page.getByText("Frame content", { exact: true })).toBeVisible();
  const chooseImage = page.getByRole("button", { name: "Choose image" });
  await expect(chooseImage).toBeVisible();
  await chooseImage.click();
  await page.getByRole("button", { name: "Select Lobby Hero" }).click();

  await expect
    .poll(() =>
      prisma.picture.count({ where: { mediaAssetId: asset.id } }),
    )
    .toBe(1);

  // --- Point the screen at the new canvas from /screens ----------------
  await page.goto("/screens");
  await page.getByRole("button", { name: "Change" }).click();
  const sourceDialog = page.getByRole("dialog");
  await expect(
    sourceDialog.getByRole("heading", { name: "Content source" }),
  ).toBeVisible();
  await sourceDialog.getByRole("radio", { name: "Canvas" }).check();
  await sourceDialog
    .getByLabel("Canvas to show")
    .selectOption({ label: CANVAS_NAME });
  await sourceDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sourceDialog).toBeHidden();

  await expect
    .poll(async () => {
      const row = await prisma.screen.findUnique({ where: { id: screen.id } });
      return row ? { canvasId: row.canvasId, playlistId: row.playlistId } : null;
    })
    .toEqual({ canvasId, playlistId: null });

  // --- Pair the screen and sync: it now serves the canvas manifest ----
  const pair = await request.post("/api/player/pair", {
    data: { pairingCode: PAIRING_CODE },
  });
  expect(pair.ok()).toBeTruthy();
  const { deviceToken } = (await pair.json()) as { deviceToken: string };
  expect(deviceToken).toBeTruthy();

  const res = await request.get("/api/player/sync", {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  expect(res.status()).toBe(200);

  const body = (await res.json()) as {
    source: string;
    playlist: unknown;
    canvas: {
      id: string;
      panels: Array<{
        frames: Array<{ kind: string; image?: { url: string } }>;
      }>;
    } | null;
  };

  expect(body.source).toBe("canvas");
  expect(body.playlist).toBeNull();
  expect(body.canvas).not.toBeNull();
  expect(body.canvas!.id).toBe(canvasId);
  expect(body.canvas!.panels.length).toBeGreaterThanOrEqual(1);

  const frames = body.canvas!.panels[0].frames;
  expect(frames).toHaveLength(1);
  expect(frames[0].kind).toBe("image");
  expect(typeof frames[0].image?.url).toBe("string");
  expect(frames[0].image!.url.length).toBeGreaterThan(0);
});
