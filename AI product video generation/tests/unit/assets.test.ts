import { expect, test } from "vitest";
import { resolveSamplePath } from "@/lib/data/assets";

test("sample paths resolve to public files", () => expect(resolveSamplePath("sample:bookshelf.glb")).toBe("/sample/bookshelf.glb"));
test("tenant paths are not samples", () => expect(resolveSamplePath("org/proj/a-x.glb")).toBeNull());
test("sample paths cannot traverse", () => expect(resolveSamplePath("sample:../secret")).toBeNull());
