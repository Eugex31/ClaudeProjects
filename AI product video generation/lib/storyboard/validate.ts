import {
  CAMERA_PRESETS, DIRECTIONS, LIMITS,
  type CameraPreset, type Direction, type Issue, type PartManifest, type Step,
} from "./types";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateStoryboard(raw: unknown[], manifest: PartManifest): { steps: Step[]; issues: Issue[] } {
  const known = new Set(manifest.map((p) => p.id));
  const issues: Issue[] = [];
  const steps: Step[] = [];
  const usedIds = new Set<string>();
  const placedIn = new Map<string, string>();

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const r = entry as Record<string, unknown>;

    let id = str(r.id) || `step_${index + 1}`;
    while (usedIds.has(id)) id = `${id}_${index + 1}`;
    usedIds.add(id);

    const parts: string[] = [];
    for (const p of Array.isArray(r.parts) ? r.parts : []) {
      if (typeof p !== "string") continue;
      if (!known.has(p)) {
        issues.push({ level: "warning", stepId: id, message: `Unknown part "${p}" was removed from this step.` });
        continue;
      }
      if (parts.includes(p)) continue;
      if (placedIn.has(p)) {
        issues.push({ level: "warning", stepId: id, message: `Part "${p}" is placed more than once (first in ${placedIn.get(p)}).` });
      } else {
        placedIn.set(p, id);
      }
      parts.push(p);
    }

    const from = (DIRECTIONS as readonly string[]).includes(r.from as string) ? (r.from as Direction) : "above";
    const camera = (CAMERA_PRESETS as readonly string[]).includes(r.camera as string) ? (r.camera as CameraPreset) : "iso";
    const warning = str(r.warning).slice(0, LIMITS.warning);

    steps.push({
      id,
      title: str(r.title).slice(0, LIMITS.title) || `Step ${steps.length + 1}`,
      narration: str(r.narration).slice(0, LIMITS.narration),
      parts,
      from,
      camera,
      ...(warning ? { warning } : {}),
    });
  });

  if (steps.length === 0) issues.push({ level: "error", message: "The storyboard has no steps." });

  for (const p of manifest) {
    if (!placedIn.has(p.id)) issues.push({ level: "warning", message: `Part "${p.label}" (${p.id}) is never placed in any step.` });
  }
  return { steps, issues };
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** Make a stored storyboard (untrusted jsonb) safe to render: well-formed parts, validated steps. */
export function cleanStoredStoryboard(sb: { parts?: unknown; steps?: unknown } | null | undefined): { parts: PartManifest; steps: Step[] } {
  const parts: PartManifest = (Array.isArray(sb?.parts) ? sb.parts : []).filter(
    (p): p is PartManifest[number] =>
      !!p && typeof p === "object" && typeof p.id === "string" && typeof p.label === "string" && isVec3(p.size) && isVec3(p.center),
  );
  const steps = validateStoryboard(Array.isArray(sb?.steps) ? sb.steps : [], parts).steps;
  return { parts, steps };
}
