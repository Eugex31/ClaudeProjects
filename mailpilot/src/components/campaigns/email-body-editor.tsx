"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/campaigns/rich-text-editor";
import { HtmlSourceEditor, type HtmlSourceEditorHandle } from "@/components/campaigns/html-source-editor";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type BodyFormat = "RICH_TEXT" | "HTML";

export type EmailBodyEditorHandle = {
  insertMergeVar: (token: string) => void;
  setContent: (html: string) => void;
};

// Wraps the two body editors behind a Rich Text / HTML mode toggle. Switching
// Rich Text -> HTML is lossless (Tiptap's own HTML output already lives
// within the wider HTML-format allowlist, so it seeds the textarea as-is).
// Switching HTML -> Rich Text is lossy — Tiptap's setContent silently drops
// anything outside its node schema (tables, images, <style> blocks) — so
// that direction is gated behind a confirmation.
export const EmailBodyEditor = forwardRef<
  EmailBodyEditorHandle,
  {
    bodyFormat: BodyFormat;
    onBodyFormatChange: (next: BodyFormat) => void;
    content: string;
    onChange: (html: string) => void;
    disabled?: boolean;
    onFocus?: () => void;
  }
>(function EmailBodyEditor({ bodyFormat, onBodyFormatChange, content, onChange, disabled, onFocus }, ref) {
  const richTextRef = useRef<RichTextEditorHandle>(null);
  const htmlRef = useRef<HtmlSourceEditorHandle>(null);
  const [confirmSwitchToRichText, setConfirmSwitchToRichText] = useState(false);

  useImperativeHandle(ref, () => ({
    insertMergeVar: (token: string) => {
      if (bodyFormat === "HTML") htmlRef.current?.insertMergeVar(token);
      else richTextRef.current?.insertMergeVar(token);
    },
    setContent: (html: string) => {
      if (bodyFormat === "HTML") htmlRef.current?.setContent(html);
      else richTextRef.current?.setContent(html);
    },
  }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={bodyFormat === "RICH_TEXT" ? "secondary" : "ghost"}
          disabled={disabled}
          className={cn("h-7 text-xs")}
          onClick={() => {
            if (bodyFormat === "HTML") setConfirmSwitchToRichText(true);
          }}
        >
          Rich Text
        </Button>
        <Button
          type="button"
          size="sm"
          variant={bodyFormat === "HTML" ? "secondary" : "ghost"}
          disabled={disabled}
          className={cn("h-7 text-xs")}
          onClick={() => onBodyFormatChange("HTML")}
        >
          HTML
        </Button>
      </div>

      {bodyFormat === "HTML" ? (
        <HtmlSourceEditor ref={htmlRef} content={content} onChange={onChange} disabled={disabled} onFocus={onFocus} />
      ) : (
        <RichTextEditor ref={richTextRef} content={content} onChange={onChange} disabled={disabled} onFocus={onFocus} />
      )}

      <AlertDialog open={confirmSwitchToRichText} onOpenChange={setConfirmSwitchToRichText}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Rich Text?</AlertDialogTitle>
            <AlertDialogDescription>
              Rich Text doesn&apos;t support tables, images, or custom styles — anything using those will be removed
              from the content. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onBodyFormatChange("RICH_TEXT")}>Switch anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
