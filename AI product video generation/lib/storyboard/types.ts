export type Vec3 = [number, number, number];

export const DIRECTIONS = ["above", "below", "left", "right", "front", "back"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CAMERA_PRESETS = ["front", "back", "left", "right", "top", "iso"] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

export const LANGUAGES = ["en", "pt", "es", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

export type Part = { id: string; label: string; size: Vec3; center: Vec3 };
export type PartManifest = Part[];

export type Step = {
  id: string;
  title: string;
  narration: string;
  parts: string[];
  from: Direction;
  camera: CameraPreset;
  warning?: string;
};

export type Issue = { level: "error" | "warning"; message: string; stepId?: string };

export const LIMITS = { title: 60, narration: 300, warning: 200 } as const;
