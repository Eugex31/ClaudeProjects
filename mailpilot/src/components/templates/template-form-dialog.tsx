"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailBodyEditor, type BodyFormat } from "@/components/campaigns/email-body-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiGeneratePanel } from "@/components/ai/ai-generate-panel";

const NO_CATEGORY = "none";

export type TemplateRecord = {
  /** Omitted for a prefilled-but-unsaved draft (e.g. from Browse Templates
   * on the Templates page) — presence of `id`, not of `template` itself, is
   * what decides create vs. edit below, so a draft still POSTs a new row
   * rather than PATCHing one that doesn't exist. */
  id?: string;
  name: string;
  subject: string;
  body: string;
  bodyFormat?: BodyFormat;
  categoryId?: string | null;
  isFavorite?: boolean;
};

export function TemplateFormDialog({
  template,
  onSaved,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  template?: TemplateRecord;
  onSaved: () => void;
  /** Pass `null` to render no trigger at all — used when this dialog is driven
   * open programmatically (e.g. right after copying a starter template). */
  trigger?: React.ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(template?.id);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>(template?.bodyFormat ?? "RICH_TEXT");
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? NO_CATEGORY);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [openingVisual, setOpeningVisual] = useState(false);

  function handleOpenChange(next: boolean) {
    controlledOnOpenChange?.(next);
    setUncontrolledOpen(next);
    if (next) {
      setName(template?.name ?? "");
      setSubject(template?.subject ?? "");
      setBody(template?.body ?? "");
      setBodyFormat(template?.bodyFormat ?? "RICH_TEXT");
      setCategoryId(template?.categoryId ?? NO_CATEGORY);
      fetch("/api/template-categories?tab=mine")
        .then((r) => r.json())
        .then((d) => setCategories(d.categories ?? []));
    }
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    const res = await fetch(isEdit ? `/api/templates/${template!.id}` : "/api/templates", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        subject,
        body,
        bodyFormat,
        categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to save template");
      return;
    }
    toast.success(isEdit ? "Template updated" : "Template created");
    handleOpenChange(false);
    onSaved();
  }

  // Editing an already-saved template: the visual editor loads that same
  // row fresh (GET /api/templates/[id]), so there's nothing to create —
  // just navigate. Creating a new one: the visual editor only ever operates
  // on a real, existing Template row (it PATCHes on save), so it needs one
  // to exist first — save whatever's already been typed into this dialog
  // (forcing HTML, since that's what the visual editor produces) and open
  // its editor, same as the Templates page's own "New (Visual editor)"
  // entry point.
  async function handleOpenVisualEditor() {
    if (isEdit) {
      router.push(`/templates/${template!.id}/editor`);
      return;
    }
    if (!name.trim()) return;
    setOpeningVisual(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        subject,
        body,
        bodyFormat: "HTML",
        categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setOpeningVisual(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to create template");
      return;
    }
    handleOpenChange(false);
    onSaved();
    router.push(`/templates/${data.template.id}/editor`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className="mr-2 size-4" />
              New template
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>Reusable subject and body you can load into any campaign.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-subject">Subject</Label>
            <Input id="template-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Uncategorized</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AiGeneratePanel
            kind="template"
            existingSubject={subject}
            existingBody={body}
            onGenerated={(result) => {
              setSubject(result.subject);
              setBody(result.bodyHtml);
              setBodyFormat("RICH_TEXT");
            }}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Body</Label>
              {bodyFormat === "HTML" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={openingVisual || (!isEdit && !name.trim())}
                  onClick={handleOpenVisualEditor}
                  title={!isEdit && !name.trim() ? "Enter a name first" : undefined}
                >
                  <Palette className="mr-1.5 size-3.5" />
                  Build visually instead
                </Button>
              )}
            </div>
            <EmailBodyEditor bodyFormat={bodyFormat} onBodyFormatChange={setBodyFormat} content={body} onChange={setBody} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {isEdit ? "Save changes" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
