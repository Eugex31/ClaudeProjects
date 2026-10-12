import * as THREE from "three";
import type { PartManifest, Vec3 } from "@/lib/storyboard/types";

const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0;
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;

/** userData flag set by loadGlb on GLTFLoader groups that hold one glTF mesh split into primitives. */
export const MULTI_PRIMITIVE = "stepreelMultiPrimitive";

/**
 * GLTFLoader turns a glTF mesh with several primitives (typically one per material) into a
 * non-mesh object whose direct children are leaf Meshes. Such an object is ONE part, named after
 * its glTF node. Only loader-flagged objects qualify, so ordinary assembly nodes stay hierarchy.
 */
function isPrimitiveGroup(o: THREE.Object3D): boolean {
  return o.userData[MULTI_PRIMITIVE] === true && !isMesh(o) && o.children.length > 0
    && o.children.every((c) => isMesh(c) && c.children.length === 0);
}

/** Part roots in traversal order: primitive groups, plus any mesh not inside one. */
function findParts(root: THREE.Object3D): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    if (isPrimitiveGroup(o)) { parts.push(o); return; }
    if (isMesh(o)) parts.push(o);
    o.children.forEach(visit);
  };
  visit(root);
  return parts;
}

export function assignPartIds(root: THREE.Object3D): THREE.Object3D[] {
  const parts = findParts(root);
  const seen = new Set<string>();
  let unnamed = 0;
  for (const p of parts) {
    const base = p.name.trim() || `part_${String(++unnamed).padStart(2, "0")}`;
    let candidate = base;
    let n = 2;
    while (seen.has(candidate)) candidate = `${base}_${n++}`;
    p.name = candidate;
    seen.add(candidate);
  }
  return parts;
}

export function extractManifest(root: THREE.Object3D): PartManifest {
  root.updateMatrixWorld(true);
  return assignPartIds(root).map((o) => {
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    return {
      id: o.name,
      label: o.name.replace(/_/g, " "),
      size: [r4(size.x), r4(size.y), r4(size.z)] as Vec3,
      center: [r4(center.x), r4(center.y), r4(center.z)] as Vec3,
    };
  });
}

export function partObjects(root: THREE.Object3D): Map<string, THREE.Object3D> {
  return new Map(assignPartIds(root).map((o) => [o.name, o]));
}
