// Copies three's Draco glTF decoder into public/draco so loadGlb can decode Draco-compressed models
// without a CDN. The output is committed; re-run after upgrading three: `npm run copy:draco`.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const from = path.join("node_modules", "three", "examples", "jsm", "libs", "draco", "gltf");
const to = path.join("public", "draco");
mkdirSync(to, { recursive: true });
for (const file of ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]) {
  copyFileSync(path.join(from, file), path.join(to, file));
  console.log(`copied ${file}`);
}
