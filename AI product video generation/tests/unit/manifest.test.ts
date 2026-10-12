import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { MULTI_PRIMITIVE, assignPartIds, extractManifest, partObjects } from "@/lib/three/manifest";

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

  test("partObjects maps ids to part objects", () => {
    const root = new THREE.Group();
    root.add(box("a", 1, 0));
    expect(partObjects(root).get("a")).toBeInstanceOf(THREE.Mesh);
  });

  // GLTFLoader turns a node whose mesh has several primitives into a Group of Meshes (loadGlb flags it).
  const multiPrimitive = (name: string) => {
    const g = new THREE.Group();
    g.name = name;
    g.userData[MULTI_PRIMITIVE] = true;
    g.position.y = 1;
    g.add(box("side_left_mesh_0", 1, 0), box("side_left_mesh_1", 1, 2));
    return g;
  };

  test("a multi-primitive node is one part named after the node", () => {
    const root = new THREE.Group();
    root.add(multiPrimitive("side_left"), box("top", 1, 5));
    const parts = extractManifest(root);
    expect(parts.map((p) => p.id)).toEqual(["side_left", "top"]);
    expect(parts[0].size).toEqual([3, 1, 1]); // bbox of the whole group
    expect(parts[0].center).toEqual([1, 1, 0]);
    const objects = partObjects(root);
    expect(objects.get("side_left")).toBeInstanceOf(THREE.Group);
    expect(objects.size).toBe(2);
  });

  test("an unnamed multi-primitive node gets a part_NN id", () => {
    const root = new THREE.Group();
    root.add(multiPrimitive(""));
    expect(extractManifest(root).map((p) => p.id)).toEqual(["part_01"]);
  });

  test("an ordinary assembly node of meshes is not itself a part", () => {
    const root = new THREE.Group();
    const shelf = new THREE.Group();
    shelf.name = "bookshelf";
    shelf.add(box("a", 1, 0), box("b", 1, 2));
    root.add(shelf);
    expect(extractManifest(root).map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("deeper hierarchies keep one part per mesh", () => {
    const root = new THREE.Group();
    const frame = new THREE.Group();
    frame.name = "frame";
    const sub = new THREE.Group();
    sub.add(box("leg_1", 1, 0));
    frame.add(sub, box("leg_2", 1, 2));
    root.add(frame);
    expect(extractManifest(root).map((p) => p.id)).toEqual(["leg_1", "leg_2"]);
  });
});
