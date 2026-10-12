import { expect, test } from "vitest";
import { randomToken } from "@/lib/tokens";

test("32 url-safe chars, unique", () => {
  const a = randomToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(randomToken()).not.toBe(a);
});
