import path from "node:path";
import { readFileSync } from "node:fs";

import { test, expect } from "@playwright/test";

import { prisma } from "@/lib/db/root";
import { storage, assetStorageKey, assetThumbKey } from "@/lib/storage";
import { resetDb, seedPlans } from "../helpers/db";

/**
 * The playlist journey, end to end against a production build:
 *
 *   register -> seed three ready assets for the new org (two images with real
 *   MinIO objects, one web page) -> create "Lobby Loop" and land on the editor
 *   -> add all three -> reorder so the order is Bravo, Alpha, Charlie -> give the
 *   new first row a 7s duration override -> assign a seeded screen to the
 *   playlist -> pair that screen for a device token -> GET /api/player/sync and
 *   assert the assembled manifest: three items in the reordered order, the 7s
 *   override on item one, a fetchable presigned image URL, a monotonic revision,
 *   and none of the retired stub keys.
 *
 * The two library images and the seeded location + screen are written straight
 * through `@/lib/db/root` because the app has no UI for pre-existing media in a
 * brand-new org and the core-journey suite already covers screen creation from
 * the UI. Everything the playlist editor itself does is driven from the page.
 *
 * Selectors are role- and label-based. The suite owns its data: it truncates
 * every table and reseeds the plans once before the run.
 */

const SAMPLE_PNG = path.join(__dirname, "../fixtures/sample.png");
const PAIRING_CODE = "E2EPLST1";

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("register, build a playlist, assign a screen, and sync the manifest", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const email = `playlist-${stamp}@example.com`;
  const orgName = `Playlist Co ${stamp}`;

  // --- Register ----------------------------------------------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Playlist Owner");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/dashboard");

  // --- Seed three ready assets, a location and an unpaired screen -------
  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  expect(org).not.toBeNull();
  const orgId = org!.id;

  const png = readFileSync(SAMPLE_PNG);

  async function seedImage(name: string): Promise<string> {
    const asset = await prisma.mediaAsset.create({
      data: {
        organizationId: orgId,
        kind: "IMAGE",
        status: "READY",
        name,
        mimeType: "image/png",
        width: 1,
        height: 1,
        sizeBytes: BigInt(png.length),
      },
    });
    const key = assetStorageKey(orgId, asset.id, ".png");
    const thumbKey = assetThumbKey(orgId, asset.id);
    await storage.putObject(key, png, "image/png");
    await storage.putObject(thumbKey, png, "image/png");
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { storageKey: key, thumbnailKey: thumbKey },
    });
    return asset.id;
  }

  await seedImage("Alpha");
  const bravoId = await seedImage("Bravo");
  await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: "WEB",
      status: "READY",
      name: "Charlie",
      url: "https://example.com",
    },
  });

  const location = await prisma.location.create({
    data: { organizationId: orgId, name: "Playlist Location" },
  });
  const screen = await prisma.screen.create({
    data: {
      organizationId: orgId,
      locationId: location.id,
      name: "Playlist Screen",
      status: "UNPAIRED",
      pairingCode: PAIRING_CODE,
    },
  });

  // --- Create the playlist and land on the editor ---------------------
  await page.goto("/playlists");
  await page.getByRole("button", { name: /new playlist/i }).first().click();
  const newDialog = page.getByRole("dialog");
  await newDialog.getByLabel("Name", { exact: true }).fill("Lobby Loop");
  await newDialog.getByRole("button", { name: /create playlist/i }).click();
  await page.waitForURL("**/playlists/*");
  const playlistId = page.url().split("/playlists/")[1];
  expect(playlistId).toBeTruthy();

  // The ordered asset names, read from each row's duration field.
  const rowNames = () =>
    page
      .locator('input[aria-label^="Duration for "]')
      .evaluateAll((els) =>
        els.map((el) =>
          (el.getAttribute("aria-label") ?? "")
            .replace(/^Duration for /, "")
            .replace(/ in seconds$/, ""),
        ),
      );

  // --- Add all three assets ------------------------------------------
  await page.getByRole("button", { name: "Add media" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByRole("button", { name: "Select Alpha" }).click();
  await addDialog.getByRole("button", { name: "Select Bravo" }).click();
  await addDialog.getByRole("button", { name: "Select Charlie" }).click();
  await addDialog.getByRole("button", { name: /add 3 selected/i }).click();
  await expect(addDialog).toBeHidden();
  await expect.poll(rowNames).toEqual(["Alpha", "Bravo", "Charlie"]);

  // --- Reorder: move Alpha down once -> Bravo, Alpha, Charlie --------
  await page.getByRole("button", { name: "Move Alpha down" }).click();
  await expect.poll(rowNames).toEqual(["Bravo", "Alpha", "Charlie"]);

  // --- Give the new first row (Bravo) a 7s override ------------------
  const bravoDuration = page.locator(
    'input[aria-label="Duration for Bravo in seconds"]',
  );
  await bravoDuration.fill("7");
  await bravoDuration.blur();
  await expect
    .poll(async () => {
      const item = await prisma.playlistItem.findFirst({
        where: { playlistId, mediaAssetId: bravoId },
      });
      return item?.durationSeconds ?? null;
    })
    .toBe(7);

  // --- Assign the seeded screen through the editor panel -----------
  await page
    .getByRole("checkbox", { name: `Play on ${screen.name}` })
    .click();
  await expect
    .poll(async () => {
      const row = await prisma.screen.findUnique({ where: { id: screen.id } });
      return row?.playlistId ?? null;
    })
    .toBe(playlistId);

  // --- Pair the screen for a device token -------------------------
  const pairRes = await request.post("/api/player/pair", {
    data: { pairingCode: PAIRING_CODE },
  });
  expect(pairRes.ok()).toBeTruthy();
  const { deviceToken } = (await pairRes.json()) as { deviceToken: string };
  expect(deviceToken).toBeTruthy();

  // --- Sync and assert the assembled manifest -------------------
  const syncRes = await request.get("/api/player/sync", {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  expect(syncRes.ok()).toBeTruthy();
  const body = (await syncRes.json()) as {
    playlist: {
      revision: number;
      items: Array<{ kind: string; url: string; durationSeconds: number }>;
    };
    canvas?: unknown;
    manifest?: unknown;
  };

  expect(body.playlist.items).toHaveLength(3);
  // After the reorder: Bravo (IMAGE), Alpha (IMAGE), Charlie (WEB).
  expect(body.playlist.items[0].kind).toBe("IMAGE");
  expect(body.playlist.items[0].durationSeconds).toBe(7);
  const last = body.playlist.items[2];
  expect(last.kind).toBe("WEB");
  expect(last.url).toBe("https://example.com");
  expect(typeof body.playlist.revision).toBe("number");
  expect(body.playlist.revision).toBeGreaterThanOrEqual(1);

  const imageRes = await request.get(body.playlist.items[0].url);
  expect(imageRes.ok()).toBeTruthy();

  expect(body.canvas).toBeNull();
  expect("manifest" in body).toBe(false);
});
