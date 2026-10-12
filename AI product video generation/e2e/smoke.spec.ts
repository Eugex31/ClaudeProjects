import { expect, test } from "@playwright/test";

test("signup → sample → preview → share → public player", async ({ page, browser }) => {
  const email = `e2e-${Date.now()}@test.dev`;
  await page.goto("/signup");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("Password (8+ characters)").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: /Sample: 3-shelf bookshelf/ }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Preview video" }).click();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByText("Step 1 / 7")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Share link" }).click();
  const url = await page.locator("input[readonly]").inputValue();
  expect(url).toMatch(/\/v\/[A-Za-z0-9_-]{32}$/);

  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(url);
  await expect(pub.getByRole("heading", { name: /assembly guide/ })).toBeVisible();
  await pub.getByRole("button", { name: "Play" }).click();
  await expect(pub.getByText("Step 1 / 7")).toBeVisible({ timeout: 15_000 });
  await anon.close();
});

test("edit → save resets approval → approve the saved version", async ({ page }) => {
  await page.goto("/signup");
  await page.getByPlaceholder("you@company.com").fill(`e2e-approve-${Date.now()}@test.dev`);
  await page.getByPlaceholder("Password (8+ characters)").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: /Sample: 3-shelf bookshelf/ }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();

  await page.getByLabel("Title").fill("Lay out the bottom panel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved. You can now record and share the video.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
});
