import path from "node:path";

import { test, expect } from "@playwright/test";

import { resetDb, seedPlans } from "../helpers/db";

/**
 * The media library journey, end to end against a production build:
 *
 *   register -> /media empty state -> upload a PNG -> the asset card and its
 *   generated thumbnail render -> create a "Promos" folder -> move the asset
 *   into it -> tag it "fall" -> filter by kind + tag and still see it -> open
 *   the preview and see the image -> delete it, back to the empty state with the
 *   storage meter at zero -> add a web-content asset.
 *
 * The background worker is not running for e2e; that is fine, because the
 * journey only uploads an IMAGE and `finalizeUpload` derives the dimensions and
 * the thumbnail synchronously via `sharp`.
 *
 * Selectors are role- and label-based so a class-name change does not break the
 * test. The suite owns its data: it truncates every table and reseeds the plans
 * once before the run. `npm run pretest:e2e` runs `npm run storage:up`, which
 * guarantees the `lynesign-media` bucket exists, so `beforeAll` never has to
 * create one; a fresh registered org per run keeps object keys from colliding
 * with local dev data.
 */

const SAMPLE_PNG = path.join(__dirname, "../fixtures/sample.png");

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("register, upload an image, organize, tag, filter, preview, delete, and add web content", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const email = `media-${stamp}@example.com`;
  const orgName = `Media Co ${stamp}`;

  // --- Register ----------------------------------------------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Media Owner");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/dashboard");

  // --- /media starts empty --------------------------------------------
  await page.goto("/media");
  await expect(
    page.getByRole("heading", { name: "No media here yet" }),
  ).toBeVisible();
  await expect(
    page.getByText("Drag files here or use Upload to add images and videos."),
  ).toBeVisible();

  // --- Upload the fixture PNG ----------------------------------------
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PNG);

  const sampleCard = page.getByRole("button", { name: "Preview sample" });
  await expect(sampleCard).toBeVisible({ timeout: 30_000 });

  // The thumbnail was produced by `sharp` during `finalizeUpload` and pre-signed
  // by the page, so the <img> must actually decode.
  const thumb = page.locator('img[alt="sample"]');
  await expect(thumb).toBeVisible();
  expect(await thumb.getAttribute("src")).toBeTruthy();
  await expect
    .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // The storage meter now reflects the 95-byte upload (the committed fixture).
  // "95 B" also appears on the card's size line, hence `.first()` for the meter.
  await expect(page.getByText("95 B", { exact: true }).first()).toBeVisible();

  // --- Create a folder --------------------------------------------------
  await page.getByRole("button", { name: /new folder/i }).click();
  const folderDialog = page.getByRole("dialog");
  await folderDialog.getByLabel("Name", { exact: true }).fill("Promos");
  await folderDialog.getByRole("button", { name: /create folder/i }).click();
  await expect(folderDialog).toBeHidden();

  const promosLink = page.getByRole("link", { name: /Promos/ });
  await expect(promosLink).toBeVisible();

  // --- Move the asset into "Promos" ---------------------------------
  await page.getByRole("button", { name: "Actions for sample" }).click();
  await page.getByRole("menuitem", { name: "Move" }).click();
  const moveDialog = page.getByRole("dialog");
  await moveDialog.getByLabel("Folder").selectOption({ label: "Promos" });
  await moveDialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(moveDialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Preview sample" }),
  ).toBeHidden();

  // --- Into the folder --------------------------------------------------
  await promosLink.click();
  await page.waitForURL(/folder=/);
  await expect(
    page.getByRole("button", { name: "Preview sample" }),
  ).toBeVisible();

  // --- Tag it "fall" -------------------------------------------------
  await page.getByRole("button", { name: "Actions for sample" }).click();
  await page.getByRole("menuitem", { name: "Tags" }).click();
  const tagDialog = page.getByRole("dialog");
  await tagDialog.getByLabel("Add a tag").fill("fall");
  await tagDialog.getByLabel("Add a tag").press("Enter");
  await tagDialog.getByRole("button", { name: /save tags/i }).click();
  await expect(tagDialog).toBeHidden();

  // --- Filter by kind + tag ---------------------------------------
  await page.getByLabel("Filter by type").selectOption("IMAGE");
  await page.getByLabel("Search media").fill("fall");
  await expect(page).toHaveURL(/q=fall/);
  await expect(
    page.getByRole("button", { name: "Preview sample" }),
  ).toBeVisible();

  // --- Preview shows the image ------------------------------------
  await page.getByRole("button", { name: "Preview sample" }).click();
  const previewDialog = page.getByRole("dialog");
  const previewImg = previewDialog.getByRole("img", { name: "sample" });
  await expect(previewImg).toBeVisible();
  expect(await previewImg.getAttribute("src")).toBeTruthy();
  await expect
    .poll(
      () => previewImg.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(previewDialog).toBeHidden();

  // --- Clear the filters so the post-delete empty state is the plain one ---
  await page.getByLabel("Search media").fill("");
  await expect(page).toHaveURL((url) => !url.searchParams.has("q"));
  await page.getByLabel("Filter by type").selectOption("");
  await expect(page).toHaveURL((url) => !url.searchParams.has("kind"));
  await expect(
    page.getByRole("button", { name: "Preview sample" }),
  ).toBeVisible();

  // --- Delete it -----------------------------------------------------
  await page.getByRole("button", { name: "Actions for sample" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(
    page.getByRole("heading", { name: "No media here yet" }),
  ).toBeVisible();
  await expect(page.getByText("0 B", { exact: true }).first()).toBeVisible();

  // --- Add web content --------------------------------------------
  await page.goto("/media");
  await page.getByRole("button", { name: /add web content/i }).click();
  const webDialog = page.getByRole("dialog");
  await webDialog.getByLabel("Name", { exact: true }).fill("Example");
  await webDialog.getByLabel("URL", { exact: true }).fill("https://example.com");
  await webDialog.getByRole("button", { name: /add web content/i }).click();
  await expect(webDialog).toBeHidden();

  await expect(
    page.getByRole("button", { name: "Preview Example" }),
  ).toBeVisible();
  const webCard = page.locator(".group").filter({ hasText: "Example" });
  await expect(webCard.getByText("Web", { exact: true })).toBeVisible();
});
