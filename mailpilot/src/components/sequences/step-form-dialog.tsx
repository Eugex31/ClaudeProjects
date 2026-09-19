"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailBodyEditor, type EmailBodyEditorHandle, type BodyFormat } from "@/components/campaigns/email-body-editor";
import { BrowseTemplatesModal } from "@/components/templates/browse-templates-modal";
import { AiGeneratePanel } from "@/components/ai/ai-generate-panel";

export type StepRecord = {
  id: string;
  order: number;
  delaySeconds: number;
  subject: string;
  body: string;
  bodyFormat?: BodyFormat;
};

type DelayUnit = "minutes" | "hours" | "days";
const SECONDS_PER_UNIT: Record<DelayUnit, number> = { minutes: 60, hours: 3600, days: 86400 };

function secondsToUnit(seconds: number): { value: number; unit: DelayUnit } {
  if (seconds > 0 && seconds % SECONDS_PER_UNIT.days === 0) return { value: seconds / SECONDS_PER_UNIT.days, unit: "days" };
  if (seconds > 0 && seconds % SECONDS_PER_UNIT.hours === 0) return { value: seconds / SECONDS_PER_UNIT.hours, unit: "hours" };
  return { value: Math.round(seconds / SECONDS_PER_UNIT.minutes), unit: "minutes" };
}

export function StepFormDialog({
  sequenceId,
  step,
  isFirstStep,
  triggerType,
  onSaved,
  trigger,
}: {
  sequenceId: string;
  step?: StepRecord;
  isFirstStep: boolean;
  triggerType?: "MANUAL" | "TAG_ADDED" | "CONTACT_CREATED" | "DATE_FIELD";
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(step);
  const [open, setOpen] = useState(false);
  const initialDelay = secondsToUnit(step?.delaySeconds ?? (isFirstStep ? 0 : 3600));
  const [delayValue, setDelayValue] = useState(initialDelay.value);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(initialDelay.unit);
  const [subject, setSubject] = useState(step?.subject ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>(step?.bodyFormat ?? "RICH_TEXT");
  const [submitting, setSubmitting] = useState(false);
  const bodyEditorRef = useRef<EmailBodyEditorHandle>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const delay = secondsToUnit(step?.delaySeconds ?? (isFirstStep ? 0 : 3600));
      setDelayValue(delay.value);
      setDelayUnit(delay.unit);
      setSubject(step?.subject ?? "");
      setBody(step?.body ?? "");
      setBodyFormat(step?.bodyFormat ?? "RICH_TEXT");
    }
  }

  function loadTemplate(template: { subject: string; body: string; bodyFormat: BodyFormat }) {
    setSubject(template.subject);
    const formatChanging = template.bodyFormat !== bodyFormat;
    setBodyFormat(template.bodyFormat);
    setBody(template.body);
    // See campaign-builder.tsx's loadTemplate for why this is skipped when
    // the format is changing — the imperative call would otherwise hit the
    // old, about-to-unmount, wrong-format editor for one tick.
    if (!formatChanging) {
      bodyEditorRef.current?.setContent(template.body);
    }
    toast.success("Template loaded — remember to save");
  }

  async function handleSubmit() {
    if (!subject.trim()) return;
    setSubmitting(true);
    const delaySeconds = Math.round(delayValue * SECONDS_PER_UNIT[delayUnit]);
    const url = step
      ? `/api/sequences/${sequenceId}/steps/${step.id}`
      : `/api/sequences/${sequenceId}/steps`;
    const res = await fetch(url, {
      method: step ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delaySeconds, subject, body, bodyFormat }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to save step");
      return;
    }
    toast.success(isEdit ? "Step updated" : "Step added");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <Plus className="mr-1.5 size-3.5" />
            Add step
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit step" : "Add step"}</DialogTitle>
          <DialogDescription>
            {triggerType === "DATE_FIELD"
              ? "Sent this long before the contact's appointment."
              : isFirstStep
                ? "Sent this long after a contact is enrolled."
                : "Sent this long after the previous step."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="step-delay">{triggerType === "DATE_FIELD" ? "Send" : "Wait"}</Label>
                <Input
                  id="step-delay"
                  type="number"
                  min={0}
                  className="w-24"
                  value={delayValue}
                  onChange={(e) => setDelayValue(Number(e.target.value))}
                />
              </div>
              <Select value={delayUnit} onValueChange={(v) => setDelayUnit(v as DelayUnit)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BrowseTemplatesModal onSelect={loadTemplate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-subject">Subject</Label>
            <Input id="step-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <AiGeneratePanel
            kind="sequence-step"
            existingSubject={subject}
            existingBody={body}
            onGenerated={(result) => loadTemplate({ subject: result.subject, body: result.bodyHtml, bodyFormat: "RICH_TEXT" })}
          />
          <div className="flex flex-col gap-1.5">
            <Label>Body</Label>
            <EmailBodyEditor
              ref={bodyEditorRef}
              bodyFormat={bodyFormat}
              onBodyFormatChange={setBodyFormat}
              content={body}
              onChange={setBody}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !subject.trim()}>
            {isEdit ? "Save changes" : "Add step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
