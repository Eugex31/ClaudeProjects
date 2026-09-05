import path from "node:path";
import { readFileSync } from "node:fs";

import { test, expect } from "@playwright/test";

import { prisma } from "@/lib/db/root";
import { storage, assetStorageKey } from "@/lib/storage";
import { resetDb, seedPlans } from "../helpers/db";

/**
 * The campaign journey, end to end against a production build:
 *
 *   register -> seed for the new org a location, an unpaired screen, a "Base"
 *   playlist and a "Campaign" playlist (each with one ready image backed by a
 *   real MinIO object), and assign the screen to "Base" -> create a "Live Now"
 *   campaign from the UI that points at "Campaign" and whose window is already
 *   open -> target the screen's location -> pair the screen for a device token
 *   -> GET /api/player/sync and assert the campaign has taken over: source
 *   "campaign", the campaign name, the "Campaign" playlist manifest with one
 *   item, and no stub canvas key -> edit the campaign end to two hours ago and
 *   Save -> GET /api/player/sync again and assert the screen has fallen back to
 *   its "Base" playlist.
 *
 * The location, screen, playlists and library images are written straight
 * through `@/lib/db/root` because a brand-new org has no UI for pre-existing
 * media and the core-journey suite already covers screen creation from the page.
 * Everything the campaign editor itself does is driven from the UI.
 *
 * The seeded window opens two days in the past rather than the one hour the task
 * brief suggested: the later edit moves the end to roughly two hours ago, and
 * `updateCampaign` rejects an end that is not after the start, so the start has
 * to sit further back than that edited end.
 *
 * Selectors are role- and label-based. The suite owns its data: it truncates
 * every table and reseeds the plans once before the run.
 */

const SAMPLE_PNG = path.join(__dirname, "../fixtures/sample.png");
const PAIRING_CODE = "E2ECAMP1";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("register, run a campaign over the base playlist, then expire it back", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const email = `campaign-${stamp}@example.com`;
  const orgName = `Campaign Co ${stamp}`;

  // --- Register ----------------------------------------------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Campaign Owner");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/dashboard");

  // --- Seed a location, an unpaired screen, and two playlists ----------
  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  expect(org).not.toBeNull();
  const orgId = org!.id;

  const png = readFileSync(SAMPLE_PNG);

  async function seedReadyImage(name: string): Promise<string> {
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
    await storage.putObject(key, png, "image/png");
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { storageKey: key },
    });
    return asset.id;
  }

  const location = await prisma.location.create({
    data: { organizationId: orgId, name: "Campaign Site" },
  });
  const screen = await prisma.screen.create({
    data: {
      organizationId: orgId,
      locationId: location.id,
      name: "Campaign Screen",
      status: "UNPAIRED",
      pairingCode: PAIRING_CODE,
    },
  });

  const baseAssetId = await seedReadyImage("Base image");
  const basePlaylist = await prisma.playlist.create({
    data: { organizationId: orgId, name: "Base" },
  });
  await prisma.playlistItem.create({
    data: {
      organizationId: orgId,
      playlistId: basePlaylist.id,
      mediaAssetId: baseAssetId,
      position: 0,
      enabled: true,
    },
  });

  const campaignAssetId = await seedReadyImage("Campaign image");
  const campaignPlaylist = await prisma.playlist.create({
    data: { organizationId: orgId, name: "Campaign" },
  });
  await prisma.playlistItem.create({
    data: {
      organizationId: orgId,
      playlistId: campaignPlaylist.id,
      mediaAssetId: campaignAssetId,
      position: 0,
      enabled: true,
    },
  });

  await prisma.screen.update({
    where: { id: screen.id },
    data: { playlistId: basePlaylist.id },
  });

  // --- Create the campaign from the UI -------------------------------
  await page.goto("/campaigns");
  await page.getByRole("button", { name: /new campaign/i }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Live Now");
  await dialog.getByRole("combobox", { name: /playlist/i }).click();
  await page.getByRole("option", { name: "Campaign", exact: true }).click();

  const startsAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await dialog.getByLabel("Start", { exact: true }).fill(toLocalInput(startsAt));
  await dialog.getByLabel("End", { exact: true }).fill(toLocalInput(endsAt));

  await dialog.getByRole("button", { name: /create campaign/i }).click();
  await page.waitForURL("**/campaigns/*");
  const campaignId = page.url().split("/campaigns/")[1];
  expect(campaignId).toBeTruthy();

  // --- Target the screen's location -------------------------------
  await page
    .getByRole("checkbox", { name: `Target all screens at ${location.name}` })
    .click();
  await expect
    .poll(() =>
      prisma.campaignLocation.count({
        where: { campaignId, locationId: location.id },
      }),
    )
    .toBe(1);

  // --- Pair the screen for a device token -----------------------
  const pair = await request.post("/api/player/pair", {
    data: { pairingCode: PAIRING_CODE },
  });
  expect(pair.ok()).toBeTruthy();
  const { deviceToken } = (await pair.json()) as { deviceToken: string };
  expect(deviceToken).toBeTruthy();

  // --- Sync: the campaign has taken over ----------------------
  const body1 = (await (
    await request.get("/api/player/sync", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    })
  ).json()) as {
    source: string;
    campaign: { name: string } | null;
    playlist: { id: string; items: unknown[] } | null;
    canvas?: unknown;
  };

  expect(body1.source).toBe("campaign");
  expect(body1.campaign?.name).toBe("Live Now");
  expect(body1.playlist?.id).toBe(campaignPlaylist.id);
  expect(body1.playlist?.items).toHaveLength(1);
  expect(body1.canvas).toBeNull();

  // --- Edit the campaign end into the past and Save --------
  const endInput = page.getByLabel("End", { exact: true });
  await endInput.fill(toLocalInput(new Date(Date.now() - 2 * 60 * 60 * 1000)));
  await endInput.blur();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => {
      const row = await prisma.campaign.findUnique({ where: { id: campaignId } });
      return row ? row.endsAt.getTime() < Date.now() : null;
    })
    .toBe(true);

  // --- Sync: the screen has fallen back to its base playlist --
  const body2 = (await (
    await request.get("/api/player/sync", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    })
  ).json()) as { source: string; playlist: { id: string } | null };

  expect(body2.source).toBe("playlist");
  expect(body2.playlist?.id).toBe(basePlaylist.id);
});
