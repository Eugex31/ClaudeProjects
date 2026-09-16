import { defineConfig, configDefaults } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Load the project's `.env` for the test run. Without this, environment access
// in tests works only by accident: importing `@prisma/client` has a side effect
// that populates `process.env` from `.env`, so a suite that never touches
// Prisma (for example `src/lib/pairing.test.ts`) sees none of it. Loading it
// here, with no prefix filter, gives every suite the same defined environment.
const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The project postcss.config.mjs uses Next.js's string-plugin form
  // ("@tailwindcss/postcss"), which Vite's PostCSS loader rejects. Tests never
  // exercise CSS, so give Vite an empty inline PostCSS config to stop it
  // resolving that file.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    fileParallelism: false,
    // The Playwright specs under src/test/e2e are *.spec.ts too; keep vitest
    // from collecting them (they import @playwright/test and drive a browser).
    // `.claude/worktrees/**` holds Claude Code's throwaway git worktrees, which
    // carry their own copies of every test file; never collect those.
    exclude: [
      ...configDefaults.exclude,
      "src/test/e2e/**",
      ".claude/**",
    ],
    // React component tests (*.test.tsx) need a DOM; everything else stays on
    // the faster node environment.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
    env,
  },
});
