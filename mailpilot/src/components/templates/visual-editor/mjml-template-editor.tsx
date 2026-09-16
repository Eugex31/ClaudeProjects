"use client";

import { useEffect, useState } from "react";
import "grapesjs/dist/css/grapes.min.css";
import { Editor as GjsEditor, Canvas, WithEditor } from "@grapesjs/react";
import grapesjs from "grapesjs";
import grapesjsMjmlPlugin from "grapesjs-mjml";
import type { Editor } from "grapesjs";
import { EditorTopBar } from "@/components/templates/visual-editor/editor-top-bar";
import { BlockPalette } from "@/components/templates/visual-editor/block-palette";
import { BottomToolbar } from "@/components/templates/visual-editor/bottom-toolbar";
import { Skeleton } from "@/components/ui/skeleton";
import type { TemplateRecord } from "@/components/templates/visual-editor/types";

// Legacy templates (rich-text or plain HTML, never opened here before) have
// no MJML structure — a true HTML-to-MJML importer would be a much larger,
// fragile feature nobody asked for. Instead the whole existing body is
// wrapped as one visible, reorderable <mj-raw> block: the customer sees
// their existing content, can move it or hand-edit it as raw HTML, but it
// isn't automatically decomposed into fine-grained blocks unless rebuilt.
function wrapLegacyBodyAsMjml(bodyHtml: string): string {
  return `<mjml><mj-body><mj-section><mj-column><mj-raw>${bodyHtml}</mj-raw></mj-column></mj-section></mj-body></mjml>`;
}

const BRAND_FONT = "Ubuntu, Helvetica, Arial, sans-serif";
const BRAND_NAVY = "#062A43";

// Every block except Columns (mj-1/2/3-column) is a bare leaf tag
// (mj-button, mj-text, mj-image, ...) that MJML's schema only allows as a
// direct child of mj-column — confirmed live via editor.Components.canMove:
// dropping mj-button onto the wrapper, mjml, mj-body, or mj-section all
// correctly return false, only mj-column returns true. That's correct MJML
// structure, not a bug. But a column holding little or no content renders
// at its natural (tiny, sometimes ~50px) height, making it an easy-to-miss
// drop target surrounded by a much larger area of canvas that silently
// rejects the drop — which is what actually made this look broken. Giving
// every mj-column a generous minimum height fixes that, the same way
// virtually every visual email/page builder gives empty rows a visible,
// generously-sized drop zone. This is editor-only styling injected directly
// into the canvas iframe's own document (like GrapesJS's own selection/
// highlight CSS) — never part of the MJML that gets saved or sent.
function injectEditorOnlyCanvasStyles(editor: Editor) {
  const doc = editor.Canvas.getFrameEl()?.contentDocument;
  if (!doc?.head || doc.getElementById("editor-only-styles")) return;
  const style = doc.createElement("style");
  style.id = "editor-only-styles";
  style.textContent = `[data-gjs-type="mj-column"] { min-height: 80px; }`;
  doc.head.appendChild(style);
}

// Two custom blocks not natively distinguished by MJML: MJML has only one
// text component (mj-text), no separate heading — "Heading" is a same
// mj-text with brand-styled defaults (larger, bold, navy). "Unsubscribe" is
// deliberately a labeled placeholder, not a real link — the app already
// appends a real unsubscribe footer automatically at send time
// (Campaign.unsubscribeFooterEnabled via composeEmail.ts), so a block that
// inserted its own link would double up, the same problem already solved
// for the seeded LyneSign starter template.
function registerCustomBlocks(editor: Editor) {
  // Neither an immediate call nor `canvas:frame:load` reliably catches the
  // frame actually being ready here — confirmed live: at both of those
  // points `editor.Canvas.getFrameEl()` still returns undefined for this
  // MJML-plugin setup, even though the event's own name implies the frame
  // has already loaded. Polling briefly is the robust option: it succeeds
  // the instant the frame element genuinely exists, whichever internal
  // sequence produces it, and gives up harmlessly (canvas just keeps its
  // natural sizing) if init takes unexpectedly long.
  let attempts = 0;
  const tryInject = () => {
    const doc = editor.Canvas.getFrameEl()?.contentDocument;
    if (doc?.head) {
      injectEditorOnlyCanvasStyles(editor);
    } else if (attempts++ < 40) {
      setTimeout(tryInject, 100);
    }
  };
  tryInject();
  editor.BlockManager.add("custom-heading", {
    label: "Heading",
    category: "Body",
    media: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 4h2v7h6V4h2v16h-2v-7H6v7H4z"/></svg>',
    content: `<mj-text font-size="24px" font-weight="700" color="${BRAND_NAVY}" font-family="${BRAND_FONT}">Heading</mj-text>`,
  });
  editor.BlockManager.add("custom-unsubscribe", {
    label: "Unsubscribe",
    category: "More",
    media: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
    content:
      '<mj-text align="center" color="#888888" font-size="12px">Your unsubscribe footer is added automatically when this template is sent.</mj-text>',
  });
}

export function MjmlTemplateEditor({ templateId }: { templateId: string }) {
  const [template, setTemplate] = useState<TemplateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/templates/${templateId}`).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!cancelled) {
        setTemplate(data.template);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-[80vh] w-full" />
      </div>
    );
  }

  if (notFound || !template) {
    return <div className="p-6 text-sm text-muted-foreground">Template not found.</div>;
  }

  const initialContent = template.editorSource ?? wrapLegacyBodyAsMjml(template.body);

  return (
    <GjsEditor
      grapesjs={grapesjs}
      plugins={[grapesjsMjmlPlugin]}
      options={{
        height: "100%",
        storageManager: false,
        components: initialContent,
        assetManager: {
          upload: "/api/template-images",
          uploadName: "file",
          multiUpload: false,
        },
      }}
      onEditor={registerCustomBlocks}
      className="flex h-screen flex-col"
    >
      {/* @grapesjs/react's GjsEditor renders its own internal wrapper div
          (class "gjs-editor-cont") around Canvas/BlockPalette with an inline
          `height: 100%`. That percentage never resolves against this flex
          chain's height — which only exists via flex-grow (Tailwind
          `flex-1`/`h-screen`), not an explicit CSS `height` — so on first
          paint it computes to 0, collapsing every descendant (`.gjs-editor`,
          the canvas, the iframe itself) to zero height: a visually blank
          canvas that still silently accepts dropped/inserted components,
          which is what made this so easy to miss. Confirmed live: clearing
          that one inline height and letting align-items:stretch (this flex
          row's default) size the wrapper instead fixes the whole chain
          immediately. This overrides it the same way, from first paint. */}
      <style>{`.gjs-editor-cont { height: auto !important; }`}</style>
      {/* EditorTopBar and BottomToolbar call useEditor(), which throws
          synchronously if the GrapesJS instance hasn't finished initializing
          yet — GjsEditor creates it asynchronously, so these would otherwise
          render (and crash) before it exists on the very first pass.
          WithEditor (from @grapesjs/react) defers rendering its children
          until the editor is actually available.

          Canvas must NOT be wrapped in WithEditor: @grapesjs/react's own
          GjsEditor reads Canvas's mounted ref as the init() container the
          first time its setup effect runs — delaying Canvas behind the same
          "editor exists" gate would mean it can never mount in time, and
          grapesjs would init into the wrong container instead. BlockPalette
          is built on BlocksProvider, which already resolves to an empty
          state on its own rather than throwing, so it doesn't need the
          wrapper either. */}
      <WithEditor>
        <EditorTopBar templateId={templateId} saving={saving} onSaving={setSaving} />
      </WithEditor>
      <div className="flex flex-1 overflow-hidden">
        <Canvas className="flex-1" />
        <BlockPalette />
      </div>
      <WithEditor>
        <BottomToolbar />
      </WithEditor>
    </GjsEditor>
  );
}
