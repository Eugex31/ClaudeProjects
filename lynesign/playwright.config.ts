import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the LyneSign foundation build.
 *
 * The suite runs against a production build (`next build` + `next start`) on a
 * dedicated port and a dedicated database, `lynesign_test`, so it never touches
 * dev data. `npm run pretest:e2e` provisions and migrates that database before
 * Playwright starts. Test secrets below are throwaway literals for the local
 * build only; they are not real credentials.
 */

const TEST_DATABASE_URL =
  "postgresql://lynesign_app:lynesign@localhost:5433/lynesign_test?schema=public";

// Force every process this config touches -- the Playwright runner (its workers
// re-import this file) and, via `webServer.env` below, the app under test -- onto
// the dedicated `lynesign_test` database. The runner needs it because the specs
// call `resetDb()` / `seedPlans()` through `@/lib/db/root`, which truncates
// whatever `DATABASE_URL` points at; pinning it here means an ambient dev
// `DATABASE_URL` can never make the suite wipe the dev database.
process.env.DATABASE_URL = TEST_DATABASE_URL;

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "src/test/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: "test-secret-lynesign-e2e-Zwh6fwgf9ML0R4l19GWbOmVqM75Wv0",
      APP_ENCRYPTION_KEY: "NxKlXOkAKOhMwOJQzutcpA1jBF97gx9/mxayDTQ8MBU=",
      AUTH_URL: BASE_URL,
      // Build an ordinary prod bundle, not the container `output: standalone`
      // one, so `next start` serves it correctly. See next.config.ts.
      E2E_BUILD: "1",
      // Point the app under test at the local MinIO the media suite uploads to.
      // Throwaway local literals, mirrored from `.env.example`; `pretest:e2e`
      // runs `npm run storage:up` to guarantee the bucket exists.
      STORAGE_ENDPOINT: "http://localhost:9000",
      STORAGE_REGION: "us-east-1",
      STORAGE_BUCKET: "lynesign-media",
      STORAGE_ACCESS_KEY_ID: "lynesign",
      STORAGE_SECRET_ACCESS_KEY: "lynesign-dev-secret",
      STORAGE_PUBLIC_URL: "",
    },
  },
});
