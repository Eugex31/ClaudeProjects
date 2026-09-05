"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import Link from "@tiptap/extension-link";
import { FontSize } from "@/components/campaigns/font-size-extension";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  UnderlineIcon,
  Strikethrough,
  Baseline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Quote,
  Eraser,
  LinkIcon,
} from "lucide-react";

const FONT_FAMILIES = [
  { value: "", label: "Default" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
];

const FONT_SIZES = [
  { value: "", label: "Default" },
  { value: "12px", label: "12" },
  { value: "14px", label: "14" },
  { value: "16px", label: "16" },
  { value: "18px", label: "18" },
  { value: "24px", label: "24" },
  { value: "32px", label: "32" },
];

const COLOR_SWATCHES = [
  "#000000", "#4B5563", "#DC2626", "#EA580C", "#CA8A04",
  "#16A34A", "#0891B2", "#2563EB", "#7C3AED", "#DB2777",
];

export type RichTextEditorHandle = {
  insertMergeVar: (token: string) => void;
  setContent: (html: string) => void;
};

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="size-8"
      disabled={disabled}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function normalizeLinkHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function LinkButton({ editor, disabled }: { editor: ReturnType<typeof useEditor>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  if (!editor) return null;
  const isActive = editor.isActive("link");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(editor.getAttributes("link").href ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={isActive ? "secondary" : "ghost"}
          size="icon"
          className="size-8"
          disabled={disabled}
          title="Link"
          onMouseDown={(e) => e.preventDefault()}
        >
          <LinkIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <div className="flex flex-col gap-2">
          <Input
            placeholder="https://example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const href = normalizeLinkHref(value);
                if (href) {
                  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                  setOpen(false);
                }
              }
            }}
          />
          <div className="flex justify-end gap-2">
            {isActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const href = normalizeLinkHref(value);
                if (href) {
                  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                  setOpen(false);
                }
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  { content: string; onChange: (html: string) => void; disabled?: boolean; onFocus?: () => void }
>(function RichTextEditor({ content, onChange, disabled, onFocus }, ref) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content,
    extensions: [
      StarterKit.configure({ heading: false }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["paragraph", "listItem"] }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ["http", "https"],
        HTMLAttributes: { rel: null, target: null },
      }),
    ],
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-48 px-3 py-2",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onFocus: () => onFocus?.(),
  });

  useImperativeHandle(ref, () => ({
    insertMergeVar: (token: string) => {
      editor?.chain().focus().insertContent(token).run();
    },
    setContent: (html: string) => {
      // Replaces the editor's content entirely (e.g. loading a template) —
      // distinct from insertMergeVar, which inserts at the cursor. Also
      // fires onChange so the surrounding form's state stays in sync,
      // since TipTap only reads the `content` prop on initial mount.
      editor?.commands.setContent(html);
      onChange(editor?.getHTML() ?? html);
    },
  }));

  if (!editor) return null;

  return (
    <div className={cn("rounded-md border", disabled && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1">
        <ToolbarButton title="Undo" disabled={disabled} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton title="Redo" disabled={disabled} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-4" />
        </ToolbarButton>

        <Select
          disabled={disabled}
          value={editor.getAttributes("textStyle").fontFamily ?? ""}
          onValueChange={(v) =>
            v ? editor.chain().focus().setFontFamily(v).run() : editor.chain().focus().unsetFontFamily().run()
          }
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((f) => (
              <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value || undefined }}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          disabled={disabled}
          value={editor.getAttributes("textStyle").fontSize ?? ""}
          onValueChange={(v) =>
            v ? editor.chain().focus().setFontSize(v).run() : editor.chain().focus().unsetFontSize().run()
          }
        >
          <SelectTrigger className="h-8 w-16 text-xs">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToolbarButton
          title="Bold"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Underline"
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="size-4" />
        </ToolbarButton>

        <LinkButton editor={editor} disabled={disabled} />

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled} title="Text color">
              <Baseline className="size-4" style={{ color: editor.getAttributes("textStyle").color || undefined }} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <div className="grid grid-cols-5 gap-1">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-6 rounded border"
                  style={{ backgroundColor: c }}
                  title={c}
                  onClick={() => editor.chain().focus().setColor(c).run()}
                />
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-muted-foreground hover:underline"
              onClick={() => editor.chain().focus().unsetColor().run()}
            >
              Reset color
            </button>
          </PopoverContent>
        </Popover>

        <ToolbarButton
          title="Align left"
          active={editor.isActive({ textAlign: "left" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Align center"
          active={editor.isActive({ textAlign: "center" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Align right"
          active={editor.isActive({ textAlign: "right" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Justify"
          active={editor.isActive({ textAlign: "justify" })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        >
          <AlignJustify className="size-4" />
        </ToolbarButton>

        <ToolbarButton
          title="Bulleted list"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Decrease indent"
          disabled={disabled}
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
        >
          <IndentDecrease className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Increase indent"
          disabled={disabled}
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
        >
          <IndentIncrease className="size-4" />
        </ToolbarButton>

        <ToolbarButton
          title="Quote"
          active={editor.isActive("blockquote")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Strikethrough"
          active={editor.isActive("strike")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Clear formatting"
          disabled={disabled}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <Eraser className="size-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
});
