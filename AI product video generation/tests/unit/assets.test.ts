import { expect, test } from "vitest";
import { resolveSamplePath } from "@/lib/data/assets";

test("sample paths resolve to public files", () => expect(resolveSamplePath("sample:bookshelf.glb")).toBe("/sample/bookshelf.glb"));
test("tenant paths are not samples", () => expect(resolveSamplePath("org/proj/a-x.glb")).toBeNull());
test("sample paths cannot traverse", () => expect(resolveSamplePath("sample:../secret")).toBeNull());

import { isScopedModelPath } from "@/lib/data/assets";
test("scoped model paths", () => {
  expect(isScopedModelPath("sample:bookshelf.glb", "o", "p")).toBe(true);
  expect(isScopedModelPath("o/p/1-file.glb", "o", "p")).toBe(true);
  expect(isScopedModelPath("o2/p/1-file.glb", "o", "p")).toBe(false);
  expect(isScopedModelPath("o/p2/1-file.glb", "o", "p")).toBe(false);
  expect(isScopedModelPath("sample:../x", "o", "p")).toBe(false);
});
