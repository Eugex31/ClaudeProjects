import { expect, test } from "vitest";
import { HIDDEN_MESSAGE, pickMimeType, runFrames, wrapText } from "@/lib/player/record";

test("prefers mp4, then vp9 webm, then webm", () => {
  expect(pickMimeType(() => true)).toBe("video/mp4;codecs=avc1");
  expect(pickMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
  expect(pickMimeType((t) => t === "video/webm")).toBe("video/webm");
  expect(pickMimeType(() => false)).toBeNull();
});

test("wraps words to max width", () => {
  const measure = (s: string) => s.length * 10;
  expect(wrapText(measure, "one two three four", 90)).toEqual(["one two", "three", "four"]);
  expect(wrapText(measure, "", 90)).toEqual([]);
});

function harness() {
  let time = 0;
  const queue: (() => void)[] = [];
  return {
    now: () => time,
    raf: (cb: () => void) => { queue.push(cb); },
    step: (ms: number) => { time += ms; queue.shift()?.(); },
  };
}

test("runFrames resolves after total seconds", async () => {
  const h = harness();
  const frames: number[] = [];
  const p = runFrames({ total: 1, maxT: 0.8, draw: (t) => frames.push(t), raf: h.raf, now: h.now, watch: () => () => {} });
  h.step(500); h.step(600);
  await expect(p).resolves.toBeUndefined();
  expect(frames).toEqual([0.5, 0.8]);
});

test("runFrames rejects when a frame throws", async () => {
  const h = harness();
  const p = runFrames({ total: 1, maxT: 1, draw: () => { throw new Error("boom"); }, raf: h.raf, now: h.now, watch: () => () => {} });
  h.step(100);
  await expect(p).rejects.toThrow("boom");
});

test("runFrames rejects when the tab is hidden and unwatches", async () => {
  const h = harness();
  let signal: (e: Error) => void = () => {};
  let unwatched = false;
  const p = runFrames({ total: 5, maxT: 5, draw: () => {}, raf: h.raf, now: h.now, watch: (r) => { signal = r; return () => { unwatched = true; }; } });
  h.step(100);
  signal(new Error(HIDDEN_MESSAGE));
  await expect(p).rejects.toThrow("tab was hidden");
  expect(unwatched).toBe(true);
});
