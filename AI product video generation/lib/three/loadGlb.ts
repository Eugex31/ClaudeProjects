import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { assignPartIds, MULTI_PRIMITIVE } from "./manifest";

/** Draco decoder files are committed under public/draco (see scripts/copy-draco.ts). */
export const DRACO_DECODER_PATH = "/draco/";

let draco: DRACOLoader | null = null;

function createLoader(): GLTFLoader {
  draco ??= new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
  return new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
}

/** Flag groups GLTFLoader made for a single glTF mesh with several primitives (see manifest.ts). */
function flagMultiPrimitiveGroups(gltf: GLTF) {
  gltf.scene.traverse((o) => {
    const ref = gltf.parser.associations.get(o);
    if (ref && ref.meshes !== undefined && ref.primitives === undefined && !(o as THREE.Mesh).isMesh) {
      o.userData[MULTI_PRIMITIVE] = true;
    }
  });
}

export async function loadGlb(source: string | ArrayBuffer): Promise<THREE.Group> {
  const loader = createLoader();
  const gltf = typeof source === "string" ? await loader.loadAsync(source) : await loader.parseAsync(source, "");
  flagMultiPrimitiveGroups(gltf);
  const root = gltf.scene;
  assignPartIds(root);
  return root;
}
