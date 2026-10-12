import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { include: ["tests/rls/**/*.test.ts"], testTimeout: 30000, fileParallelism: false },
});
