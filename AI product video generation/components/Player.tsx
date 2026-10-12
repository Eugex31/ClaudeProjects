"use client";
import { useEffect, useRef, useState } from "react";
import { AssemblyScene } from "@/lib/three/scene";
import { captionFor } from "@/lib/player/captions";
import { locate, type Timeline } from "@/lib/player/timeline";
import { speak, stopSpeaking } from "@/lib/player/speech";
import type { Language, PartManifest, Step } from "@/lib/storyboard/types";
import { Captions } from "./Captions";

export function Player({ modelUrl, steps, manifest, language }: {
  modelUrl: string; steps: Step[]; manifest: PartManifest; language: Language;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const lastIndexRef = useRef(-1);
  const [scene, setScene] = useState<AssemblyScene | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [index, setIndex] = useState(0);
  const [inputs, setInputs] = useState({ modelUrl, steps, manifest });
  if (inputs.modelUrl !== modelUrl || inputs.steps !== steps || inputs.manifest !== manifest) {
    // Reset playback state when the inputs change (adjusting state during render).
    setInputs({ modelUrl, steps, manifest });
    setScene(null);
    setTimeline(null);
    setError(null);
    setPlaying(false);
    setIndex(0);
  }
  const ready = scene !== null && timeline !== null && timeline.steps.length > 0;

  useEffect(() => {
    timeRef.current = 0;
    lastIndexRef.current = -1;
    stopSpeaking();
    let cancelled = false;
    const canvas = canvasRef.current!;
    const s = new AssemblyScene(canvas);
    const resize = () => s.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener("resize", resize);
    s.load(modelUrl)
      .then(() => {
        if (cancelled) return;
        s.setStoryboard(steps, manifest);
        s.renderAt(0);
        setTimeline(s.timeline);
        setScene(s);
      })
      .catch(() => { if (!cancelled) setError("The 3D model could not be loaded (the link may have expired)."); });
    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      stopSpeaking();
      s.dispose();
    };
  }, [modelUrl, steps, manifest]);

  useEffect(() => {
    if (!playing || !scene) return;
    let last = performance.now();
    let raf = 0;
    lastIndexRef.current = -1;
    const tick = (now: number) => {
      timeRef.current = Math.min(timeRef.current + ((now - last) / 1000) * speed, scene.timeline.total);
      last = now;
      scene.renderAt(timeRef.current);
      const { index: i } = locate(scene.timeline, timeRef.current);
      if (i !== lastIndexRef.current) {
        lastIndexRef.current = i;
        setIndex(i);
        speak(scene.timeline.steps[i]?.step.narration ?? "", language, speed);
      }
      if (timeRef.current >= scene.timeline.total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, scene, speed, language]);

  function jump(i: number) {
    if (!scene || scene.timeline.steps.length === 0) return;
    const clamped = Math.max(0, Math.min(i, scene.timeline.steps.length - 1));
    timeRef.current = scene.timeline.steps[clamped].start;
    lastIndexRef.current = clamped;
    setIndex(clamped);
    stopSpeaking();
    scene.renderAt(timeRef.current);
    if (playing) speak(scene.timeline.steps[clamped].step.narration, language, speed);
  }

  function togglePlay() {
    if (!ready) return;
    if (timeRef.current >= timeline.total) timeRef.current = 0;
    if (playing) stopSpeaking();
    setPlaying(!playing);
  }

  const caption = timeline ? captionFor(timeline, index) : null;
  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded bg-zinc-100">
        <canvas ref={canvasRef} className="h-full w-full" />
        <Captions caption={caption} />
        {error && (
          <div role="alert" className="absolute inset-0 grid place-items-center bg-white/80 text-center text-red-700">
            <div>
              <p>{error}</p>
              <button onClick={() => window.location.reload()} className="mt-2 rounded border px-3 py-1 text-sm">Reload page</button>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <button disabled={!ready} onClick={() => jump(index - 1)} className="rounded border px-2 py-1">◀ Prev</button>
        <button disabled={!ready} onClick={togglePlay} className="rounded bg-black px-3 py-1 text-white">{playing ? "Pause" : "Play"}</button>
        <button disabled={!ready} onClick={() => jump(index + 1)} className="rounded border px-2 py-1">Next ▶</button>
        <button disabled={!ready} onClick={() => jump(0)} className="rounded border px-2 py-1">Restart</button>
        <label className="ml-auto">Speed{" "}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded border">
            <option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option>
          </select>
        </label>
      </div>
    </div>
  );
}
