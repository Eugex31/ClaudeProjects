"use client";

import { useState } from "react";
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

type Template = { id: string; name: string };
type Tag = { id: string; name: string };

export type NewsletterRecord = {
  id: string;
  name: string;
  templateId: string;
  targetTagId: string | null;
  frequency: "WEEKLY" | "MONTHLY";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hourUtc: number;
  minuteUtc: number;
};

const ALL_CONTACTS = "all";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function NewsletterFormDialog({
  newsletter,
  onSaved,
  trigger,
}: {
  newsletter?: NewsletterRecord;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(newsletter);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [targetTagId, setTargetTagId] = useState(ALL_CONTACTS);
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [time, setTime] = useState("09:00");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      fetch("/api/templates")
        .then((r) => r.json())
        .then((d) => setTemplates(d.templates ?? []));
      fetch("/api/tags")
        .then((r) => r.json())
        .then((d) => setTags(d.tags ?? []));

      setName(newsletter?.name ?? "");
      setTemplateId(newsletter?.templateId ?? "");
      setTargetTagId(newsletter?.targetTagId ?? ALL_CONTACTS);
      setFrequency(newsletter?.frequency ?? "WEEKLY");
      setDayOfWeek(String(newsletter?.dayOfWeek ?? 1));
      setDayOfMonth(String(newsletter?.dayOfMonth ?? 1));
      setTime(`${pad(newsletter?.hourUtc ?? 9)}:${pad(newsletter?.minuteUtc ?? 0)}`);
    }
  }

  async function handleSubmit() {
    if (!name.trim() || !templateId) return;
    setSubmitting(true);
    const [hourUtc, minuteUtc] = time.split(":").map(Number);
    const payload = {
      name,
      templateId,
      targetTagId: targetTagId === ALL_CONTACTS ? "" : targetTagId,
      frequency,
      dayOfWeek: frequency === "WEEKLY" ? Number(dayOfWeek) : null,
      dayOfMonth: frequency === "MONTHLY" ? Number(dayOfMonth) : null,
      hourUtc,
      minuteUtc,
    };

    const res = await fetch(isEdit ? `/api/newsletters/${newsletter!.id}` : "/api/newsletters", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to save newsletter");
      return;
    }
    toast.success(isEdit ? "Newsletter updated" : "Newsletter created");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 size-4" />
            New newsletter
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit newsletter" : "New newsletter"}</DialogTitle>
          <DialogDescription>Recurring sends built from a template, on a schedule.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newsletter-name">Name</Label>
            <Input id="newsletter-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Send to</Label>
            <Select value={targetTagId} onValueChange={setTargetTagId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CONTACTS}>All contacts</SelectItem>
                {tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    Tagged &quot;{tag.name}&quot;
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as "WEEKLY" | "MONTHLY")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {frequency === "WEEKLY" ? (
              <div className="flex flex-col gap-1.5">
                <Label>Day</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newsletter-day-of-month">Day of month</Label>
                <Input
                  id="newsletter-day-of-month"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newsletter-time">Time (UTC)</Label>
            <Input id="newsletter-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim() || !templateId}>
            {isEdit ? "Save changes" : "Create newsletter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
