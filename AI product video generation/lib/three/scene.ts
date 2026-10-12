import * as THREE from "three";
import type { PartManifest, Step, Vec3 } from "@/lib/storyboard/types";
import { buildTimeline, easeOutCubic, FLY_IN_SECONDS, locate, type Timeline } from "@/lib/player/timeline";
import { cameraPosition, type Bounds } from "@/lib/player/camera";
import { partMeshes } from "./manifest";
import { loadGlb } from "./loadGlb";

const HIGHLIGHT = new THREE.Color(0xff8a00);
const CAMERA_EASE_SECONDS = 1;

type PartState = { mesh: THREE.Mesh; basePosition: THREE.Vector3; materials: THREE.MeshStandardMaterial[] };

export class AssemblyScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 1000);
  private parts = new Map<string, PartState>();
  private bounds: Bounds = { center: [0, 0, 0], radius: 1 };
  private raycaster = new THREE.Raycaster();
  timeline: Timeline = { steps: [], total: 0, extent: 1 };

  constructor(private canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: opts.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xf4f4f5);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
  }

  async load(url: string) {
    const root = await loadGlb(url);
    this.scene.add(root);
    root.updateMatrixWorld(true);
    for (const [id, mesh] of partMeshes(root)) {
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = source.map((m) => {
        const std = m instanceof THREE.MeshStandardMaterial ? m.clone() : new THREE.MeshStandardMaterial({ color: (m as any).color ?? 0xcccccc });
        std.transparent = true;
        return std;
      });
      mesh.material = materials.length === 1 ? materials[0] : materials;
      this.parts.set(id, { mesh, basePosition: mesh.position.clone(), materials });
    }
    const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
    this.bounds = { center: sphere.center.toArray() as Vec3, radius: sphere.radius || 1 };
    this.camera.near = this.bounds.radius / 100;
    this.camera.far = this.bounds.radius * 100;
    this.camera.updateProjectionMatrix();
  }

  setStoryboard(steps: Step[], manifest: PartManifest) {
    this.timeline = buildTimeline(steps, manifest);
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  renderAt(t: number) {
    const { index, local } = locate(this.timeline, t);
    const entry = this.timeline.steps[index];
    const visible = new Set(entry?.visibleBefore ?? []);
    const animating = new Map((entry?.animating ?? []).map((a) => [a.partId, a.offset]));
    const progress = easeOutCubic(local / FLY_IN_SECONDS);
    const glow = Math.max(0, 1 - local / (FLY_IN_SECONDS + 1));

    for (const [id, part] of this.parts) {
      const offset = animating.get(id);
      part.mesh.visible = visible.has(id) || offset !== undefined;
      part.mesh.position.copy(part.basePosition);
      if (offset) part.mesh.position.add(this.worldOffsetToLocal(part.mesh, offset).multiplyScalar(1 - progress));
      this.styleMaterials(part, 1, offset ? glow : 0);
    }

    const prev = this.timeline.steps[index - 1]?.step.camera ?? entry?.step.camera ?? "iso";
    const from = new THREE.Vector3(...cameraPosition(prev, this.bounds));
    const to = new THREE.Vector3(...cameraPosition(entry?.step.camera ?? "iso", this.bounds));
    this.placeCamera(from.lerp(to, easeOutCubic(local / CAMERA_EASE_SECONDS)));
    this.renderer.render(this.scene, this.camera);
  }

  renderStepEnd(index: number, selected: string[]) {
    const placed = new Set<string>();
    this.timeline.steps.slice(0, index + 1).forEach((s) => s.step.parts.forEach((p) => placed.add(p)));
    const sel = new Set(selected);
    for (const [id, part] of this.parts) {
      part.mesh.visible = true;
      part.mesh.position.copy(part.basePosition);
      this.styleMaterials(part, placed.has(id) || sel.has(id) ? 1 : 0.15, sel.has(id) ? 0.8 : 0);
    }
    const preset = this.timeline.steps[index]?.step.camera ?? "iso";
    this.placeCamera(new THREE.Vector3(...cameraPosition(preset, this.bounds)));
    this.renderer.render(this.scene, this.camera);
  }

  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.parts.values()].filter((p) => p.mesh.visible).map((p) => p.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.name : null;
  }

  dispose() {
    this.renderer.dispose();
    this.parts.forEach((p) => p.materials.forEach((m) => m.dispose()));
  }

  private placeCamera(position: THREE.Vector3) {
    this.camera.position.copy(position);
    this.camera.lookAt(...this.bounds.center);
  }

  private worldOffsetToLocal(mesh: THREE.Mesh, offset: Vec3): THREE.Vector3 {
    const parent = mesh.parent!;
    const worldBase = parent.localToWorld(mesh.position.clone());
    const a = parent.worldToLocal(worldBase.clone());
    const b = parent.worldToLocal(worldBase.add(new THREE.Vector3(...offset)));
    return b.sub(a);
  }

  private styleMaterials(part: PartState, opacity: number, glow: number) {
    for (const m of part.materials) {
      m.opacity = opacity;
      m.depthWrite = opacity === 1;
      m.emissive.copy(HIGHLIGHT).multiplyScalar(glow);
    }
  }
}
