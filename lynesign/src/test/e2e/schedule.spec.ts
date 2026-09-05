import { test, expect } from "@playwright/test";

import { prisma } from "@/lib/db/root";
import { resetDb, seedPlans } from "../helpers/db";

/**
 * The schedule journey, end to end against a production build:
 *
 *   register -> seed for the new org a location, a screen and two playlists
 *   -> open /schedule and confirm the screen is selected in the picker
 *   -> click an empty grid cell and confirm the create dialog opens with that
 *   weekday and start time prefilled -> fill it (name, playlist, a second
 *   weekday, 09:00 to 12:00) and submit -> a rule block with the playlist name
 *   appears on the grid -> open that block's edit dialog and confirm every field
 *   is populated -> create a second rule on the same weekday for 10:00 to 11:00
 *   and confirm the overlap error is shown, the dialog stays open, and no new
 *   block is added.
 *
 * The location, screen and playlists are written straight through `@/lib/db/root`
 * because a brand-new org has no UI for pre-existing playlists and the other
 * suites already cover screen and playlist creation from their pages. Everything
 * the schedule grid and its dialog do is driven from the UI.
 *
 * The existing e2e suites all register a fresh org rather than sign in as a
 * seeded demo user, because every spec truncates the test database in
 * `beforeAll`; this spec follows that pattern. Selectors are role- and
 * label-based, with the grid's own `data-rule-block` attribute for the rule
 * blocks.
 */

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("register, author a schedule rule from the grid, then get blocked on an overlap", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const email = `schedule-${stamp}@example.com`;
  const orgName = `Schedule Co ${stamp}`;
  const PLAYLIST_NAME = "Lobby Loop";

  // --- Register --------------------------------------------------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Schedule Owner");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/dashboard");

  // --- Seed a location, a screen and two playlists ------------------------
  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  expect(org).not.toBeNull();
  const orgId = org!.id;

  const location = await prisma.location.create({
    data: { organizationId: orgId, name: "Schedule Site" },
  });
  const screen = await prisma.screen.create({
    data: {
      organizationId: orgId,
      locationId: location.id,
      name: "Schedule Screen",
      status: "UNPAIRED",
      pairingCode: "E2ESCHD1",
    },
  });
  const playlist = await prisma.playlist.create({
    data: { organizationId: orgId, name: PLAYLIST_NAME },
  });
  await prisma.playlist.create({
    data: { organizationId: orgId, name: "Overflow Loop" },
  });

  // --- Open the schedule page for that screen ---------------------------
  await page.goto("/schedule");
  await expect(page.getByLabel("Screen", { exact: true })).toHaveValue(
    screen.id,
  );

  // --- Click an empty grid cell: the create dialog opens prefilled ------
  await page
    .getByRole("button", { name: "Add a rule on Monday at 09:00" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "New schedule rule" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Monday")).toBeChecked();
  await expect(dialog.getByLabel("Start time", { exact: true })).toHaveValue(
    "09:00",
  );

  // --- Fill and submit the first rule --------------------------------
  await dialog.getByLabel("Name", { exact: true }).fill("Morning Loop");
  await dialog
    .getByLabel("Playlist", { exact: true })
    .selectOption({ label: PLAYLIST_NAME });
  await dialog.getByLabel("Tuesday").check();
  await dialog.getByLabel("Start time", { exact: true }).fill("09:00");
  await dialog.getByLabel("End time", { exact: true }).fill("12:00");
  await dialog.getByRole("button", { name: "Create rule" }).click();

  await expect(dialog).toBeHidden();

  // --- A rule block with the playlist name is on the grid -------------
  const blocks = page.locator("[data-rule-block]");
  await expect(blocks.first()).toBeVisible();
  await expect(blocks.first()).toContainText(PLAYLIST_NAME);
  // One block per weekday the rule runs: Monday and Tuesday.
  await expect(blocks).toHaveCount(2);

  // --- Open the block's edit dialog: every field is populated --------
  await blocks.first().click();
  const editDialog = page.getByRole("dialog");
  await expect(
    editDialog.getByRole("heading", { name: "Edit schedule rule" }),
  ).toBeVisible();
  await expect(editDialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Morning Loop",
  );
  await expect(editDialog.getByLabel("Playlist", { exact: true })).toHaveValue(
    playlist.id,
  );
  await expect(editDialog.getByLabel("Monday")).toBeChecked();
  await expect(editDialog.getByLabel("Tuesday")).toBeChecked();
  await expect(editDialog.getByLabel("Start time", { exact: true })).toHaveValue(
    "09:00",
  );
  await expect(editDialog.getByLabel("End time", { exact: true })).toHaveValue(
    "12:00",
  );
  await editDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editDialog).toBeHidden();

  // --- A second rule that overlaps the first is rejected ------------
  await page.getByRole("button", { name: "New rule" }).click();
  const overlapDialog = page.getByRole("dialog");
  await overlapDialog.getByLabel("Name", { exact: true }).fill("Late Morning");
  await overlapDialog
    .getByLabel("Playlist", { exact: true })
    .selectOption({ label: PLAYLIST_NAME });
  await overlapDialog.getByLabel("Monday").check();
  await overlapDialog.getByLabel("Start time", { exact: true }).fill("10:00");
  await overlapDialog.getByLabel("End time", { exact: true }).fill("11:00");
  await overlapDialog.getByRole("button", { name: "Create rule" }).click();

  const alert = overlapDialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/overlaps/i);
  await expect(alert).toContainText("Morning Loop");
  await expect(overlapDialog).toBeVisible();

  // No new block was added: still just the Monday and Tuesday pair.
  await expect(page.locator("[data-rule-block]")).toHaveCount(2);
  expect(
    await prisma.scheduleRule.count({ where: { organizationId: orgId } }),
  ).toBe(1);
});
