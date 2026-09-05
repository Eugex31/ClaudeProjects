"use client";

import { BlocksProvider } from "@grapesjs/react";
import type { Block } from "grapesjs";
import { PALETTE_GROUP_LABELS, type PaletteGroupKey } from "@/components/templates/visual-editor/types";

// grapesjs-mjml registers its native blocks with human-readable labels
// ("Text", "Image", "Button", "Divider", "Social", "1 Column", "2 Columns",
// ...) rather than a fixed, documented list of ids — so blocks are grouped
// here by matching keywords in their label, not by hardcoding ids that could
// silently change between plugin versions. Anything unmatched still shows
// up under "More" rather than disappearing.
function groupForBlock(block: Block): PaletteGroupKey {
  const label = String(block.get("label") ?? block.getId() ?? "").toLowerCase();
  if (/column|section|attachment/.test(label)) return "content";
  if (/button/.test(label)) return "content";
  if (/text|heading|paragraph|divider|spacer/.test(label)) return "body";
  if (/image|photo|logo/.test(label)) return "images";
  return "more";
}

const GROUP_ORDER: PaletteGroupKey[] = ["content", "body", "images", "more"];

export function BlockPalette() {
  return (
    <BlocksProvider>
      {({ blocks, dragStart }) => {
        const grouped = new Map<PaletteGroupKey, Block[]>();
        for (const block of blocks) {
          // Hide blocks with no visible label (internal/head-only MJML
          // components like mj-head, mj-font aren't meant to be dragged).
          if (!block.get("label")) continue;
          const key = groupForBlock(block);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(block);
        }

        return (
          <div className="flex h-full w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-background p-3">
            {GROUP_ORDER.filter((key) => grouped.has(key)).map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <p className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {PALETTE_GROUP_LABELS[key]}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {grouped.get(key)!.map((block) => (
                    <button
                      key={block.getId()}
                      type="button"
                      onMouseDown={(ev) => {
                        // GrapesJS's custom (framework-rendered) block UI drags via
                        // pointer events (pointermove/pointerup) armed on the canvas
                        // by dragStart() below — NOT native HTML5 drag-and-drop.
                        // Starting the drag from a native `draggable`/onDragStart
                        // (as this used to) breaks silently: once a native OS drag
                        // begins, the browser stops firing pointermove/mousemove
                        // globally, so GrapesJS's pointer-based drop target never
                        // receives the movement or release it's waiting for.
                        ev.preventDefault();
                        dragStart(block, ev.nativeEvent);
                      }}
                      className="flex flex-col items-center gap-1 rounded-md border bg-muted/30 px-2 py-3 text-center text-[11px] font-medium select-none hover:bg-muted"
                      title={String(block.get("label") ?? "")}
                    >
                      <span
                        className="[&_svg]:size-5 [&_svg]:mx-auto"
                        dangerouslySetInnerHTML={{ __html: String(block.get("media") ?? "") }}
                      />
                      <span className="line-clamp-2">{String(block.get("label") ?? "")}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      }}
    </BlocksProvider>
  );
}
