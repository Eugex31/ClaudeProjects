import * as THREE from "three";
import type { PartManifest, Vec3 } from "@/lib/storyboard/types";

const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0;

export function assignPartIds(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const seen = new Set<string>();
  let unnamed = 0;
  for (const m of meshes) {
    const base = m.name.trim() || `part_${String(++unnamed).padStart(2, "0")}`;
    let candidate = base;
    let n = 2;
    while (seen.has(candidate)) candidate = `${base}_${n++}`;
    m.name = candidate;
    seen.add(candidate);
  }
  return meshes;
}

export function extractManifest(root: THREE.Object3D): PartManifest {
  root.updateMatrixWorld(true);
  return assignPartIds(root).map((m) => {
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    return {
      id: m.name,
      label: m.name.replace(/_/g, " "),
      size: [r4(size.x), r4(size.y), r4(size.z)] as Vec3,
      center: [r4(center.x), r4(center.y), r4(center.z)] as Vec3,
    };
  });
}

export function partMeshes(root: THREE.Object3D): Map<string, THREE.Mesh> {
  return new Map(assignPartIds(root).map((m) => [m.name, m]));
}
