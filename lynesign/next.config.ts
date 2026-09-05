import type { NextConfig } from "next";

// `output: "standalone"` is for the container image. It is incompatible with
// `next start` (which the Playwright e2e harness uses): `next start` prints
// "does not work with output: standalone" and serves a mismatched build. The
// e2e run sets `E2E_BUILD=1` (playwright.config.ts `webServer.env`) so its
// `next build` + `next start` produces an ordinary, fully-supported prod build.
const nextConfig: NextConfig = {
  output: process.env.E2E_BUILD ? undefined : "standalone",
};

export default nextConfig;
