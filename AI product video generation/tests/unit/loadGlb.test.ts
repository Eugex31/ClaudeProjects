import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { loadGlb } from "@/lib/three/loadGlb";
import { extractManifest, partObjects } from "@/lib/three/manifest";

// GLTFExporter needs FileReader, which Node lacks.
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
}
(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;

const toArrayBuffer = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

function mesh(name: string, x: number, materials = 1) {
  const geometry = new THREE.BoxGeometry(1, 1, 1); // 6 groups
  const mats = Array.from({ length: materials }, (_, i) => new THREE.MeshStandardMaterial({ color: i ? 0xff0000 : 0x00ff00 }));
  if (materials > 1) {
    geometry.clearGroups();
    geometry.addGroup(0, 18, 0);
    geometry.addGroup(18, 18, 1);
  }
  const m = new THREE.Mesh(geometry, materials > 1 ? mats : mats[0]);
  m.name = name;
  m.position.x = x;
  return m;
}

test("a two-material CAD node round-trips as ONE part named after the node", async () => {
  const scene = new THREE.Scene();
  const frame = new THREE.Group();
  frame.name = "frame";
  frame.add(mesh("leg_a", 3), mesh("leg_b", 5));
  scene.add(mesh("side_left", 0, 2), mesh("top", 1), frame);
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;

  const root = await loadGlb(glb);
  const ids = extractManifest(root).map((p) => p.id);
  expect(ids).toEqual(["side_left", "top", "leg_a", "leg_b"]);
  const side = partObjects(root).get("side_left")!;
  expect((side as THREE.Mesh).isMesh).toBeFalsy();
  expect(side.children).toHaveLength(2);
});

test("sample bookshelf still yields 24 parts through loadGlb", async () => {
  const root = await loadGlb(toArrayBuffer(readFileSync("public/sample/bookshelf.glb")));
  expect(extractManifest(root)).toHaveLength(24);
});
