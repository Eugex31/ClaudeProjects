import type { Timeline } from "./timeline";

export function captionFor(timeline: Timeline, index: number) {
  const entry = timeline.steps[index];
  if (!entry) return null;
  const { title, narration, warning } = entry.step;
  return { counter: `Step ${index + 1} / ${timeline.steps.length}`, title, narration, ...(warning ? { warning } : {}) };
}
