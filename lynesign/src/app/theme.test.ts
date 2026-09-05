import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");

describe("design tokens", () => {
  it("defines the LyneSign palette", () => {
    expect(css).toContain("--ls-navy: #1B2A45");
    expect(css).toContain("--ls-tan: #D9A468");
  });
  it("has a dark override block", () => {
    expect(css).toMatch(/\.dark\s*\{/);
  });
  it("maps tokens into the Tailwind theme", () => {
    expect(css).toContain("@theme");
    expect(css).toMatch(/--color-navy:\s*var\(--ls-navy\)/);
  });
});
