import type { Step } from "./types";

export function moveStep(steps: Step[], from: number, to: number): Step[] {
  const next = [...steps];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function togglePart(steps: Step[], index: number, partId: string): Step[] {
  const has = steps[index].parts.includes(partId);
  return steps.map((step, i) => {
    if (i === index) return { ...step, parts: has ? step.parts.filter((p) => p !== partId) : [...step.parts, partId] };
    return has ? step : { ...step, parts: step.parts.filter((p) => p !== partId) };
  });
}

export function addStep(steps: Step[], after: number): Step[] {
  const ids = new Set(steps.map((s) => s.id));
  let n = steps.length + 1;
  while (ids.has(`step_${n}`)) n++;
  const step: Step = { id: `step_${n}`, title: "New step", narration: "", parts: [], from: "above", camera: "iso" };
  const next = [...steps];
  next.splice(after + 1, 0, step);
  return next;
}

export const removeStep = (steps: Step[], index: number) => steps.filter((_, i) => i !== index);
