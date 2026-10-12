import { expect, test } from "vitest";
import { assetPath, normalizeManualText } from "@/lib/manual";

test("normalizes whitespace but keeps paragraphs", () => {
  expect(normalizeManualText("  Step 1:   Attach   side.\n\n\n\nStep 2:\tInsert dowels.  "))
    .toBe("Step 1: Attach side.\n\nStep 2: Insert dowels.");
});
test("caps length", () => {
  expect(normalizeManualText("a".repeat(600_000))).toHaveLength(500_000);
});
test("asset path sanitizes filename", () => {
  expect(assetPath("o", "p", "a", "My Manual (v2).pdf")).toBe("o/p/a-My_Manual__v2_.pdf");
});
