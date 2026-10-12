import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildBookshelf } from "@/lib/sample/bookshelf";
import { SAMPLE_STEPS } from "@/lib/sample/storyboard";
import { assignPartIds, extractManifest } from "@/lib/three/manifest";
import { validateStoryboard } from "@/lib/storyboard/validate";

test("bookshelf has 24 uniquely named parts", () => {
  const ids = extractManifest(buildBookshelf()).map((p) => p.id);
  expect(ids).toHaveLength(24);
  expect(ids).toContain("cam_lock_8");
  expect(ids.some((id) => id.startsWith("part_"))).toBe(false);
});

test("sample storyboard places every part exactly once with no issues", () => {
  const { steps, issues } = validateStoryboard(SAMPLE_STEPS, extractManifest(buildBookshelf()));
  expect(steps).toHaveLength(7);
  expect(issues).toEqual([]);
});

test("exported GLB keeps the same part ids", async () => {
  const buf = readFileSync("public/sample/bookshelf.glb");
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const ids = assignPartIds(gltf.scene).map((o) => o.name).sort();
  expect(ids).toEqual(extractManifest(buildBookshelf()).map((p) => p.id).sort());
});
