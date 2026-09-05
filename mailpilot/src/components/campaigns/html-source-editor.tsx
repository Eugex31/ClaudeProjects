"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Code2, Eye } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export type HtmlSourceEditorHandle = {
  insertMergeVar: (token: string) => void;
  setContent: (html: string) => void;
};

// Defaults to a rendered VISUAL preview, not raw markup — most customers
// using a branded HTML template don't read HTML and shouldn't have to.
// Editing full HTML content has no drag-and-drop equivalent inline here
// (that lives in the separate visual template editor at
// /templates/[id]/editor, which works on structured MJML, not an arbitrary
// HTML string) — so "Edit HTML source" stays available as an explicit,
// clearly-labeled escape hatch for anyone who does want to touch markup,
// rather than removing the capability. Sanitization always happens
// server-side at compose time (composeEmail.ts) regardless of what's typed
// here — this component does no client-side validation of its own.
export const HtmlSourceEditor = forwardRef<
  HtmlSourceEditorHandle,
  { content: string; onChange: (html: string) => void; disabled?: boolean; onFocus?: () => void }
>(function HtmlSourceEditor({ content, onChange, disabled, onFocus }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"preview" | "source">("preview");

  useImperativeHandle(ref, () => ({
    insertMergeVar: (token: string) => {
      // Inserting a token is an editing action — switch to source mode so
      // it's visible where the token landed, rather than silently editing
      // behind the preview.
      setMode("source");
      const el = textareaRef.current;
      if (!el) {
        onChange(content + token);
        return;
      }
      const start = el.selectionStart ?? content.length;
      const end = el.selectionEnd ?? content.length;
      const next = content.slice(0, start) + token + content.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    },
    setContent: (html: string) => {
      onChange(html);
    },
  }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <Button
            type="button"
            size="sm"
            variant={mode === "preview" ? "secondary" : "ghost"}
            className="h-7 gap-1.5 text-xs"
            onClick={() => setMode("preview")}
          >
            <Eye className="size-3.5" />
            Preview
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "source" ? "secondary" : "ghost"}
            className="h-7 gap-1.5 text-xs"
            onClick={() => setMode("source")}
          >
            <Code2 className="size-3.5" />
            Edit HTML source
          </Button>
        </div>
      </div>

      {mode === "preview" ? (
        <div className="h-96 overflow-hidden rounded-md border bg-white">
          <iframe
            srcDoc={content || "<p style='font-family:sans-serif;color:#9ca3af;padding:16px'>No content yet — switch to \"Edit HTML source\" to add some.</p>"}
            title="Email preview"
            sandbox="allow-same-origin"
            className="h-full w-full border-0"
          />
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onFocus?.()}
          disabled={disabled}
          spellCheck={false}
          rows={20}
          className="min-h-96 resize-y font-mono text-xs"
          placeholder="<html>...</html>"
        />
      )}
    </div>
  );
});
