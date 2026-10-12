import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { assignPartIds, extractManifest, partMeshes } from "@/lib/three/manifest";

const box = (name: string, w: number, x: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 1));
  m.name = name;
  m.position.x = x;
  return m;
};

describe("extractManifest", () => {
  test("named meshes keep their names and get world-space bounds", () => {
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.position.y = 2;
    g.add(box("side_left", 2, 1));
    root.add(g);
    const [p] = extractManifest(root);
    expect(p.id).toBe("side_left");
    expect(p.label).toBe("side left");
    expect(p.size).toEqual([2, 1, 1]);
    expect(p.center).toEqual([1, 2, 0]);
  });

  test("unnamed meshes get part_NN ids in traversal order", () => {
    const root = new THREE.Group();
    root.add(box("", 1, 0), box("", 1, 2));
    expect(extractManifest(root).map((p) => p.id)).toEqual(["part_01", "part_02"]);
  });

  test("duplicate names get suffixes and assignment is idempotent", () => {
    const root = new THREE.Group();
    root.add(box("dowel", 1, 0), box("dowel", 1, 2));
    const first = assignPartIds(root).map((m) => m.name);
    expect(first).toEqual(["dowel", "dowel_2"]);
    expect(assignPartIds(root).map((m) => m.name)).toEqual(first);
  });

  test("partMeshes maps ids to meshes", () => {
    const root = new THREE.Group();
    root.add(box("a", 1, 0));
    expect(partMeshes(root).get("a")).toBeInstanceOf(THREE.Mesh);
  });
});
