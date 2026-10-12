"use client";
import { useEffect, useRef, useState } from "react";
import { AssemblyScene } from "@/lib/three/scene";
import type { PartManifest, Step } from "@/lib/storyboard/types";

export function EditorViewport({ modelUrl, steps, parts, selectedIndex, onPartClick }: {
  modelUrl: string; steps: Step[]; parts: PartManifest; selectedIndex: number; onPartClick?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<AssemblyScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState(modelUrl);
  if (loadedUrl !== modelUrl) {
    // Reset when the model changes (adjusting state during render).
    setLoadedUrl(modelUrl);
    setScene(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current!;
    const s = new AssemblyScene(canvas);
    const resize = () => s.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener("resize", resize);
    s.load(modelUrl)
      .then(() => { if (!cancelled) setScene(s); })
      .catch(() => { if (!cancelled) setError("The 3D model could not be loaded."); });
    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      s.dispose();
    };
  }, [modelUrl]);

  useEffect(() => {
    if (!scene) return;
    scene.setStoryboard(steps, parts);
    scene.renderStepEnd(selectedIndex, steps[selectedIndex]?.parts ?? []);
  }, [scene, steps, parts, selectedIndex]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded bg-zinc-100">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-crosshair"
        onClick={(e) => {
          const id = scene?.pick(e.clientX, e.clientY);
          if (id && onPartClick) onPartClick(id);
        }}
      />
      {error && <p role="alert" className="absolute inset-0 grid place-items-center text-red-700">{error}</p>}
      <p className="absolute left-2 top-2 rounded bg-white/80 px-2 text-xs">Click a part to add it to / remove it from the selected step. Faded parts are not placed yet.</p>
    </div>
  );
}
