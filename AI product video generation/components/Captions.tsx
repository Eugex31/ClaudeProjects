import type { captionFor } from "@/lib/player/captions";

export function Captions({ caption }: { caption: ReturnType<typeof captionFor> }) {
  if (!caption) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-white">
      <div className="text-xs uppercase tracking-wide opacity-80">{caption.counter}</div>
      <div className="text-lg font-semibold">{caption.title}</div>
      <div className="text-sm">{caption.narration}</div>
      {caption.warning && <div className="mt-1 inline-block rounded bg-amber-400 px-2 py-0.5 text-sm font-medium text-black">⚠ {caption.warning}</div>}
    </div>
  );
}
