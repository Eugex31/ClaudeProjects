import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3000";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL, launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] } },
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_SITE_URL: baseURL },
  },
});
