import { test, expect } from "@playwright/test";

import { resetDb, seedPlans } from "../helpers/db";

/**
 * The core onboarding journey, end to end against a production build:
 *
 *   register -> land on the dashboard with the onboarding checklist
 *   -> add a location -> add a screen -> read its pairing code
 *   -> a player exchanges that code for a device token (POST /api/player/pair)
 *   -> the screen reads back as Online -> the dashboard tiles show 1 / 1.
 *
 * Selectors are role- and label-based so a class-name change does not break the
 * test. The suite owns its data: it truncates every table and reseeds the plans
 * once before the run.
 */

const PAIRING_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("register, add a location and screen, pair it, and see it online", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const email = `founder-${stamp}@example.com`;
  const orgName = `Acme ${stamp}`;

  // --- Register -------------------------------------------------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Founder One");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByText(/0 of 4 steps done/i)).toBeVisible();

  // --- Add a location ----------------------------------------------------
  await page.goto("/locations");
  await page.getByRole("button", { name: /add location/i }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Head Office");
  await page.getByRole("button", { name: /create location/i }).click();
  await expect(page.getByRole("cell", { name: "Head Office" })).toBeVisible();

  // --- Add a screen ----------------------------------------------------------
  await page.goto("/screens");
  await page.getByRole("button", { name: /add screen/i }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Lobby Display");
  await page.getByRole("combobox", { name: /location/i }).click();
  await page.getByRole("option", { name: "Head Office" }).click();
  await page.getByRole("button", { name: /create screen/i }).click();

  // --- Read the pairing code ----------------------------------------------
  const codeBox = page.getByLabel("Pairing code");
  await expect(codeBox).toBeVisible();
  const pairingCode = ((await codeBox.textContent()) ?? "").trim();
  expect(pairingCode).toMatch(PAIRING_CODE);

  // --- A player exchanges the code for a device token ---------------------
  const pairResponse = await request.post("/api/player/pair", {
    data: { pairingCode },
  });
  expect(pairResponse.status()).toBe(200);
  const pairBody = (await pairResponse.json()) as { deviceToken?: string; screenId?: string };
  expect(pairBody.deviceToken).toBeTruthy();
  expect(pairBody.screenId).toBeTruthy();

  // --- The screen reads back as Online ----------------------------------
  await page.goto("/screens");
  const screenRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Lobby Display" }) });
  await expect(screenRow).toBeVisible();
  await expect(screenRow.getByText("Online", { exact: true })).toBeVisible();

  // --- The dashboard tiles show one screen and one location -------------
  await page.goto("/dashboard");
  const statValue = (label: string) =>
    page.locator(
      `xpath=//p[normalize-space(text())=${JSON.stringify(label)}]/following-sibling::p[1]`,
    );
  await expect(statValue("Screens")).toHaveText("1");
  await expect(statValue("Locations")).toHaveText("1");
  await expect(page.getByText(/3 of 4 steps done/i)).toBeVisible();
});
