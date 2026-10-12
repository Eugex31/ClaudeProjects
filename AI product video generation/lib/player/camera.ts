import type { CameraPreset, Vec3 } from "@/lib/storyboard/types";

export type Bounds = { center: Vec3; radius: number };

const DIRS: Record<CameraPreset, Vec3> = {
  front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 1, 0.001], iso: [1, 1, 1],
};

export function cameraPosition(preset: CameraPreset, bounds: Bounds): Vec3 {
  const d = DIRS[preset];
  const len = Math.hypot(...d);
  const dist = bounds.radius * 2.5;
  return [0, 1, 2].map((i) => bounds.center[i] + (d[i] / len) * dist + 0) as Vec3;
}
