import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assignPartIds } from "./manifest";

export async function loadGlb(source: string | ArrayBuffer): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = typeof source === "string" ? await loader.loadAsync(source) : await loader.parseAsync(source, "");
  const root = gltf.scene;
  assignPartIds(root);
  return root;
}
