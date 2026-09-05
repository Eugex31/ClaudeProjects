import { test, expect } from "@playwright/test";

import { resetDb, seedPlans } from "../helpers/db";

/**
 * Regression guard for the `/users` RSC boundary, end to end against a
 * production build.
 *
 * `src/app/(app)/users/page.tsx` is a Server Component. It used to pass
 * DataTable column definitions whose `render` fields are closures (the role and
 * status `Badge`s, the per-row actions menu) straight into the `"use client"`
 * DataTable. React cannot serialize a function across the server/client
 * boundary, so `next start` threw "Functions cannot be passed directly to
 * Client Components" while serializing the page's RSC payload -- and it only
 * fired once the org actually had a membership row or an open invitation to
 * render, which the core-journey suite never creates. The same failure took
 * down every server action invoked from the page, because the action response
 * re-renders it.
 *
 * The fix moved the closures into the `"use client"` `MembersTable` wrapper.
 * This test locks it in: it registers (one owner membership), loads `/users`,
 * sends an invitation through the on-page dialog (a server action), then loads
 * `/users` again with both a member and a pending invitation present and
 * asserts every closure-rendered cell shows up and the document is a 200.
 *
 * Selectors are role- and label-based. The suite owns its data: it truncates
 * every table and reseeds the plans once before the run.
 */

test.beforeAll(async () => {
  await resetDb();
  await seedPlans();
});

test("/users renders member and invitation rows against the production build", async ({
  page,
}) => {
  const stamp = Date.now();
  const founderEmail = `owner-${stamp}@example.com`;
  const inviteeEmail = `invitee-${stamp}@example.com`;
  const orgName = `Users Co ${stamp}`;

  // --- Register: creates the caller's owner membership --------------------
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Owner One");
  await page.getByLabel("Email", { exact: true }).fill(founderEmail);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery-staple");
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/dashboard");

  // --- /users with a member but no invitations yet ----------------------
  const firstLoad = await page.goto("/users");
  expect(firstLoad?.status()).toBe(200);
  const memberRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: founderEmail }) });
  await expect(
    memberRow.getByRole("cell", { name: "Owner One", exact: true }),
  ).toBeVisible();
  // The role column's `render` closure -- an owner badge on the member's row.
  await expect(memberRow.getByText("Owner", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No invitations are waiting to be accepted."),
  ).toBeVisible();

  // --- Invite a member: a server action invoked from this page ----------
  await page.getByRole("button", { name: /invite member/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email", { exact: true }).fill(inviteeEmail);
  await dialog.getByRole("button", { name: /send invitation/i }).click();
  await expect(dialog).toBeHidden();

  // --- /users with both a member and a pending invitation --------------
  const secondLoad = await page.goto("/users");
  expect(secondLoad?.status()).toBe(200);

  await expect(
    page.getByRole("cell", { name: founderEmail }),
  ).toBeVisible();

  const invitationRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: inviteeEmail }) });
  await expect(invitationRow).toBeVisible();
  // The status column's `render` closure -- an "Invited" badge.
  await expect(invitationRow.getByText("Invited", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No invitations are waiting to be accepted."),
  ).toBeHidden();
});
