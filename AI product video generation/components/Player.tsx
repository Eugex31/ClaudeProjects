"use client";
import { useEffect, useRef, useState } from "react";
import { AssemblyScene } from "@/lib/three/scene";
import { captionFor } from "@/lib/player/captions";
import { locate } from "@/lib/player/timeline";
import { speak, stopSpeaking } from "@/lib/player/speech";
import type { Language, PartManifest, Step } from "@/lib/storyboard/types";
import { Captions } from "./Captions";

export function Player({ modelUrl, steps, manifest, language }: {
  modelUrl: string; steps: Step[]; manifest: PartManifest; language: Language;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<AssemblyScene | null>(null);
  const timeRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new AssemblyScene(canvas);
    sceneRef.current = scene;
    const resize = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener("resize", resize);
    scene.load(modelUrl)
      .then(() => { scene.setStoryboard(steps, manifest); scene.renderAt(0); setReady(true); })
      .catch(() => setError("The 3D model could not be loaded."));
    return () => { window.removeEventListener("resize", resize); stopSpeaking(); scene.dispose(); };
  }, [modelUrl, steps, manifest]);

  useEffect(() => {
    if (!playing || !ready) return;
    const scene = sceneRef.current!;
    let last = performance.now();
    let lastIndex = -1;
    let raf = 0;
    const tick = (now: number) => {
      timeRef.current = Math.min(timeRef.current + ((now - last) / 1000) * speed, scene.timeline.total);
      last = now;
      scene.renderAt(timeRef.current);
      const { index: i } = locate(scene.timeline, timeRef.current);
      if (i !== lastIndex) {
        lastIndex = i;
        setIndex(i);
        speak(scene.timeline.steps[i]?.step.narration ?? "", language, speed);
      }
      if (timeRef.current >= scene.timeline.total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready, speed, language]);

  function jump(i: number) {
    const scene = sceneRef.current!;
    const clamped = Math.max(0, Math.min(i, scene.timeline.steps.length - 1));
    timeRef.current = scene.timeline.steps[clamped]?.start ?? 0;
    setIndex(clamped);
    stopSpeaking();
    scene.renderAt(timeRef.current);
    if (playing) speak(scene.timeline.steps[clamped].step.narration, language, speed);
  }

  const caption = ready ? captionFor(sceneRef.current!.timeline, index) : null;
  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded bg-zinc-100">
        <canvas ref={canvasRef} className="h-full w-full" />
        <Captions caption={caption} />
        {error && <p role="alert" className="absolute inset-0 grid place-items-center text-red-700">{error}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <button disabled={!ready} onClick={() => jump(index - 1)} className="rounded border px-2 py-1">◀ Prev</button>
        <button disabled={!ready} onClick={() => {
          if (timeRef.current >= (sceneRef.current?.timeline.total ?? 0)) timeRef.current = 0;
          if (playing) stopSpeaking();
          setPlaying(!playing);
        }} className="rounded bg-black px-3 py-1 text-white">{playing ? "Pause" : "Play"}</button>
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
