import type { PartManifest, Step } from "@/lib/storyboard/types";
import { AssemblyScene } from "@/lib/three/scene";
import { captionFor } from "./captions";
import { locate } from "./timeline";

const MIME_PREFERENCE = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"];
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const TAIL_SECONDS = 0.5;

export function pickMimeType(isSupported: (t: string) => boolean): string | null {
  return MIME_PREFERENCE.find((t) => isSupported(t)) ?? null;
}

export function wrapText(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export const HIDDEN_MESSAGE = "Recording cancelled: the tab was hidden. Keep this tab visible while recording.";

/** Real-time frame loop. Rejects if a frame throws or a watcher signals failure (hidden tab, recorder error). */
export function runFrames(o: {
  total: number; maxT: number; draw: (t: number) => void; onProgress?: (fraction: number) => void;
  raf: (cb: () => void) => void; now: () => number;
  watch: (reject: (err: Error) => void) => () => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const watcher: { off?: () => void } = {};
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      watcher.off?.();
      if (err) reject(err); else resolve();
    };
    watcher.off = o.watch((err) => finish(err));
    if (done) watcher.off();
    const startedAt = o.now();
    const tick = () => {
      if (done) return;
      try {
        const t = (o.now() - startedAt) / 1000;
        o.draw(Math.min(t, o.maxT));
        o.onProgress?.(Math.min(t / o.total, 1));
        if (t >= o.total) return finish();
        o.raf(tick);
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };
    o.raf(tick);
  });
}

function drawCaption(ctx: CanvasRenderingContext2D, caption: NonNullable<ReturnType<typeof captionFor>>) {
  const pad = 32;
  const maxWidth = WIDTH - pad * 2;
  ctx.font = "24px system-ui, sans-serif";
  const narration = wrapText((s) => ctx.measureText(s).width, caption.narration, maxWidth).slice(0, 3);
  const height = 110 + narration.length * 30 + (caption.warning ? 40 : 0);
  const grad = ctx.createLinearGradient(0, HEIGHT - height, 0, HEIGHT);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.35, "rgba(0,0,0,0.75)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, HEIGHT - height, WIDTH, height);
  let y = HEIGHT - height + 50;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(caption.counter.toUpperCase(), pad, y);
  y += 34;
  ctx.fillStyle = "#fff";
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.fillText(caption.title, pad, y);
  ctx.font = "24px system-ui, sans-serif";
  for (const line of narration) { y += 30; ctx.fillText(line, pad, y); }
  if (caption.warning) {
    y += 36;
    ctx.font = "bold 20px system-ui, sans-serif";
    const text = `⚠ ${caption.warning}`;
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(pad - 6, y - 22, ctx.measureText(text).width + 12, 30);
    ctx.fillStyle = "#000";
    ctx.fillText(text, pad, y);
  }
}

export async function recordVideo(opts: {
  modelUrl: string; steps: Step[]; manifest: PartManifest; onProgress?: (fraction: number) => void;
}): Promise<{ blob: Blob; mimeType: string }> {
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error("This browser cannot record video. Use a recent Chrome or Edge.");

  const glCanvas = document.createElement("canvas");
  glCanvas.width = WIDTH;
  glCanvas.height = HEIGHT;
  const out = document.createElement("canvas");
  out.width = WIDTH;
  out.height = HEIGHT;
  const ctx = out.getContext("2d")!;

  const scene = new AssemblyScene(glCanvas, { preserveDrawingBuffer: true });
  let stream: MediaStream | undefined;
  try {
    scene.renderer.setPixelRatio(1);
    scene.resize(WIDTH, HEIGHT);
    await scene.load(opts.modelUrl);
    scene.setStoryboard(opts.steps, opts.manifest);
    const total = scene.timeline.total + TAIL_SECONDS;

    stream = out.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const drawFrame = (t: number) => {
      scene.renderAt(t);
      ctx.drawImage(glCanvas, 0, 0);
      const caption = captionFor(scene.timeline, locate(scene.timeline, t).index);
      if (caption) drawCaption(ctx, caption);
    };

    drawFrame(0);
    recorder.start(1000);
    try {
      await runFrames({
        total,
        maxT: scene.timeline.total,
        draw: drawFrame,
        onProgress: opts.onProgress,
        raf: (cb) => { requestAnimationFrame(cb); },
        now: () => performance.now(),
        watch: (reject) => {
          const onVisibility = () => {
            if (document.hidden) reject(new Error(HIDDEN_MESSAGE));
          };
          document.addEventListener("visibilitychange", onVisibility);
          recorder.onerror = (e) => {
            const err = (e as Event & { error?: unknown }).error;
            reject(new Error(`Recording failed: ${err instanceof Error ? err.message : String(err ?? "unknown error")}`));
          };
          return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            recorder.onerror = null;
          };
        },
      });
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
    }
    await stopped;
    return { blob: new Blob(chunks, { type: mimeType.split(";")[0] }), mimeType };
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    scene.dispose();
    scene.renderer.forceContextLoss();
  }
}
