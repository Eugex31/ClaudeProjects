import * as THREE from "three";

const W = 0.8, H = 1.2, D = 0.3, T = 0.018;
const wood = () => new THREE.MeshStandardMaterial({ color: 0xc8a27a, roughness: 0.8 });
const metal = () => new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.8, roughness: 0.3 });
const board = () => new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.9 });

function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.set(x, y, z);
  return m;
}

export function buildBookshelf(): THREE.Group {
  const g = new THREE.Group();
  g.name = "bookshelf";
  const inner = W - 2 * T;
  const yBottom = 0.05, yTop = H - T / 2;

  g.add(mesh("side_left", new THREE.BoxGeometry(T, H, D), wood(), -(W - T) / 2, H / 2, 0));
  g.add(mesh("side_right", new THREE.BoxGeometry(T, H, D), wood(), (W - T) / 2, H / 2, 0));
  g.add(mesh("bottom", new THREE.BoxGeometry(inner, T, D), wood(), 0, yBottom, 0));
  g.add(mesh("top", new THREE.BoxGeometry(inner, T, D), wood(), 0, yTop, 0));
  [0.33, 0.62, 0.91].forEach((y, i) => g.add(mesh(`shelf_${i + 1}`, new THREE.BoxGeometry(inner, T, D - 0.02), wood(), 0, y, 0.01)));
  g.add(mesh("back_panel", new THREE.BoxGeometry(W, H, 0.004), board(), 0, H / 2, -D / 2 - 0.002));

  let dowel = 0, cam = 0;
  for (const y of [yBottom, yTop]) {
    for (const side of [-1, 1]) {
      for (const z of [-0.1, 0.1]) {
        const d = mesh(`dowel_${++dowel}`, new THREE.CylinderGeometry(0.004, 0.004, 0.03, 12), metal(), side * (inner / 2 - 0.005), y, z);
        d.rotation.z = Math.PI / 2;
        g.add(d);
        g.add(mesh(`cam_lock_${++cam}`, new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 16), metal(), side * (inner / 2 - 0.035), y + T / 2, z + 0.03));
      }
    }
  }
  return g;
}
