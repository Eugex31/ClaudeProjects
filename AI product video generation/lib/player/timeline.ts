import type { Direction, PartManifest, Step, Vec3 } from "@/lib/storyboard/types";

export const FLY_IN_SECONDS = 1.5;
const WORDS_PER_SECOND = 2.5;

const DIRECTION_VECTORS: Record<Direction, Vec3> = {
  above: [0, 1, 0], below: [0, -1, 0], left: [-1, 0, 0],
  right: [1, 0, 0], front: [0, 0, 1], back: [0, 0, -1],
};

export function stepDuration(narration: string): number {
  const words = narration.trim() ? narration.trim().split(/\s+/).length : 0;
  return Math.max(4, words / WORDS_PER_SECOND + FLY_IN_SECONDS);
}

export type TimelineStep = {
  step: Step; index: number; start: number; duration: number;
  visibleBefore: string[];
  animating: { partId: string; offset: Vec3 }[];
};
export type Timeline = { steps: TimelineStep[]; total: number; extent: number };

export function buildTimeline(steps: Step[], manifest: PartManifest): Timeline {
  const extent = manifest.reduce((m, p) => Math.max(m, ...p.size), 0) || 1;
  const placed: string[] = [];
  let t = 0;
  const out = steps.map((step, index) => {
    const duration = stepDuration(step.narration);
    const v = DIRECTION_VECTORS[step.from];
    const entry: TimelineStep = {
      step, index, start: t, duration,
      visibleBefore: [...placed],
      // "+ 0" turns -0 into 0 so offsets compare cleanly
      animating: step.parts.map((partId) => ({ partId, offset: v.map((c) => c * 1.5 * extent + 0) as Vec3 })),
    };
    for (const p of step.parts) if (!placed.includes(p)) placed.push(p);
    t += duration;
    return entry;
  });
  return { steps: out, total: t, extent };
}

export function locate(timeline: Timeline, t: number): { index: number; local: number } {
  const n = timeline.steps.length;
  if (n === 0) return { index: -1, local: 0 };
  const clamped = Math.min(Math.max(t, 0), timeline.total);
  for (let i = 0; i < n; i++) {
    const s = timeline.steps[i];
    if (clamped < s.start + s.duration) return { index: i, local: clamped - s.start };
  }
  return { index: n - 1, local: timeline.steps[n - 1].duration };
}

export function easeOutCubic(x: number): number {
  const c = Math.min(Math.max(x, 0), 1);
  return 1 - Math.pow(1 - c, 3);
}
