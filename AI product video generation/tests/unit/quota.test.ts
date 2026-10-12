import { expect, test } from "vitest";
import { canGenerate, currentPeriod } from "@/lib/quota";

test("period is UTC year-month", () => {
  expect(currentPeriod(new Date("2026-01-31T23:30:00-05:00"))).toBe("2026-02");
  expect(currentPeriod(new Date("2026-10-12T10:00:00Z"))).toBe("2026-10");
});
test("quota boundary", () => {
  expect(canGenerate(19, 20)).toBe(true);
  expect(canGenerate(20, 20)).toBe(false);
  expect(canGenerate(0, 0)).toBe(false);
});
