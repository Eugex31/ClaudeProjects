import { test, expect } from "@playwright/test";

import { prisma } from "@/lib/db/root";
import { resetDb, seedPlans } from "../helpers/db";

/**
 * The analytics journey, end to end against a production build:
 *
 *   register -> seed for the new org a location, an unpaired screen, a media
 *   asset, a playlist, and eight PlaybackEvent rows across three distinct UTC
 *   days with known totals (day -3: 2 plays / 30s, day -2: 3 plays / 45s,
 *   day -1: 3 plays / 60s, so 8 plays / 135s) -> open /analytics -> the summary
 *   tiles read 8 total plays and (135 / 3600) play hours -> the content table
 *   lists the seeded asset -> the plays-by-day chart draws at least one bar
 *   -> move the From date past the oldest day and the total drops to 6.
 *
 * The rows are written straight through `@/lib/db/root`: a brand-new org has no
 * player reporting into it and the ingest route is unit-tested elsewhere. The
 * three seeded days all sit inside the page's default rolling 30-day range.
 *
 * The existing e2e suites all register a fresh org rather than sign in as a
 * seeded demo user, because every spec truncates the test database in
 * `beforeAll`; this spec follows that pattern. Selectors are label- and
 * role-based, plus the card's `data-slot="card"` attribute to pin a summary
 * tile to its own label.
 */

const DAY_MS = 86_400_000;
const ASSET_NAME = "Analytics Sample Asset";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Noon UTC on the day `offsetDays` from today, so an airing never straddles a
 * UTC date boundary. */
function middayUtc(offsetDays: number): Date {
  const t = new Date(Date.now() + offsetDays * DAY_MS);
  return new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 12, 0, 0),
  );
}

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("register, then read the analytics summary and narrow the date range", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const email = `analytics-${stamp}@example.com`;
  const orgName = `Analytics Co ${stamp}`;

  // --- Register -----------------------------------------------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Analytics Owner");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/dashboard");

  // --- Seed a location, a screen, an asset, a playlist, and airings ------
  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  expect(org).not.toBeNull();
  const orgId = org!.id;

  const location = await prisma.location.create({
    data: { organizationId: orgId, name: "Analytics Site" },
  });
  const screen = await prisma.screen.create({
    data: {
      organizationId: orgId,
      locationId: location.id,
      name: "Analytics Screen",
      status: "UNPAIRED",
      pairingCode: "E2EANLY1",
    },
  });
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: "IMAGE",
      status: "READY",
      name: ASSET_NAME,
      mimeType: "image/png",
      width: 1,
      height: 1,
      sizeBytes: BigInt(1),
    },
  });
  const playlist = await prisma.playlist.create({
    data: { organizationId: orgId, name: "Analytics Base" },
  });

  const day3 = middayUtc(-3); // 2 plays x 15s = 30s
  const day2 = middayUtc(-2); // 3 plays x 15s = 45s
  const day1 = middayUtc(-1); // 3 plays x 20s = 60s

  const plan: Array<{ base: Date; count: number; seconds: number }> = [
    { base: day3, count: 2, seconds: 15 },
    { base: day2, count: 3, seconds: 15 },
    { base: day1, count: 3, seconds: 20 },
  ];

  let n = 0;
  const events = plan.flatMap(({ base, count, seconds }) =>
    Array.from({ length: count }, (_, i) => {
      n += 1;
      return {
        id: `evt-${n}`,
        organizationId: orgId,
        screenId: screen.id,
        mediaAssetId: asset.id,
        playlistId: playlist.id,
        source: "playlist",
        airedAt: new Date(base.getTime() + i * 60_000),
        durationSeconds: seconds,
      };
    }),
  );
  await prisma.playbackEvent.createMany({ data: events });

  // --- Open the analytics page -----------------------------------------
  await page.goto("/analytics");

  const tile = (label: string) =>
    page.locator('[data-slot="card"]').filter({ hasText: label });

  await expect(tile("Total plays")).toContainText("8");
  await expect(tile("Play hours")).toContainText((135 / 3600).toFixed(1));

  // --- The content table lists the seeded asset ---------------------
  await expect(page.getByRole("cell", { name: ASSET_NAME })).toBeVisible();

  // --- The plays-by-day chart draws at least one bar --------------
  const bars = page.getByRole("img", { name: "Plays per day" }).locator("rect");
  expect(await bars.count()).toBeGreaterThan(0);

  // --- Narrow the range past the oldest day: 8 - 2 -> 6 ---------
  const fromInput = page.getByLabel("From", { exact: true });
  await fromInput.fill(ymd(day2));
  await fromInput.blur();

  await expect(tile("Total plays")).toContainText("6");
});
