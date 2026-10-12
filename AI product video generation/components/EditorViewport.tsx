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
      .catch(() => { if (!cancelled) setError("The 3D model could not be loaded (the link may have expired)."); });
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
      {error && (
        <div role="alert" className="absolute inset-0 grid place-items-center bg-white/80 text-center text-red-700">
          <div>
            <p>{error}</p>
            <button onClick={() => window.location.reload()} className="mt-2 rounded border px-3 py-1 text-sm">Reload page</button>
          </div>
        </div>
      )}
      <p className="absolute left-2 top-2 rounded bg-white/80 px-2 text-xs">Click a part to add it to / remove it from the selected step. Faded parts are not placed yet.</p>
    </div>
  );
}
