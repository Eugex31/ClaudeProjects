"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
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
import { StepFormDialog, type StepRecord } from "@/components/sequences/step-form-dialog";
import { EnrollmentsPanel } from "@/components/sequences/enrollments-panel";

type Tag = { id: string; name: string };

type SequenceData = {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  triggerType: "MANUAL" | "TAG_ADDED" | "CONTACT_CREATED" | "DATE_FIELD";
  triggerTagId: string | null;
  steps: StepRecord[];
  activeEnrollmentCount: number;
};

function formatDelay(seconds: number): string {
  if (seconds === 0) return "immediately";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

export function SequenceBuilder({ sequenceId }: { sequenceId: string }) {
  const router = useRouter();
  const [sequence, setSequence] = useState<SequenceData | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteStep, setDeleteStep] = useState<StepRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/sequences/${sequenceId}`);
    if (res.ok) {
      const { sequence: s } = await res.json();
      setSequence(s);
    }
    setLoading(false);
  }, [sequenceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []));
  }, [load]);

  async function updateTrigger(triggerType: string, triggerTagId: string | null) {
    const res = await fetch(`/api/sequences/${sequenceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerType, triggerTagId: triggerTagId ?? "" }),
    });
    if (!res.ok) {
      toast.error("Failed to update trigger");
      return;
    }
    load();
  }

  async function toggleActive() {
    if (!sequence) return;
    setBusy(true);
    const res = await fetch(`/api/sequences/${sequenceId}/${sequence.status === "ACTIVE" ? "pause" : "activate"}`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      toast.error(body.error ?? "Failed to update sequence status");
      return;
    }
    toast.success(sequence.status === "ACTIVE" ? "Sequence paused" : "Sequence activated");
    load();
  }

  async function handleDeleteStep() {
    if (!deleteStep) return;
    const res = await fetch(`/api/sequences/${sequenceId}/steps/${deleteStep.id}`, { method: "DELETE" });
    setDeleteStep(null);
    if (!res.ok) {
      toast.error("Failed to delete step");
      return;
    }
    load();
  }

  if (loading || !sequence) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const locked = sequence.status === "ACTIVE";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{sequence.name}</h1>
          <StatusBadge status={sequence.status} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant={sequence.status === "ACTIVE" ? "outline" : "default"} disabled={busy} onClick={toggleActive}>
            {sequence.status === "ACTIVE" ? "Pause" : "Activate"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="steps">Steps ({sequence.steps.length})</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments ({sequence.activeEnrollmentCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-end sm:gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Trigger</Label>
              <Select
                value={sequence.triggerType}
                disabled={locked}
                onValueChange={(v) => updateTrigger(v, v === "TAG_ADDED" ? sequence.triggerTagId : null)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                  <SelectItem value="TAG_ADDED">Tag added</SelectItem>
                  <SelectItem value="CONTACT_CREATED">Contact created</SelectItem>
                  <SelectItem value="DATE_FIELD">Appointment date</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sequence.triggerType === "TAG_ADDED" && (
              <div className="flex flex-col gap-1.5">
                <Label>Tag</Label>
                <Select
                  value={sequence.triggerTagId ?? undefined}
                  disabled={locked}
                  onValueChange={(v) => updateTrigger("TAG_ADDED", v)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Choose a tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {sequence.triggerType === "DATE_FIELD" && (
              <p className="text-sm text-muted-foreground sm:pb-2">
                Each step below fires that long <em>before</em> the contact&apos;s appointment date, not after the
                previous step. Set a contact&apos;s appointment in the Contacts page to enroll them.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {sequence.steps.map((step, index) => (
              <div key={step.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">
                    Step {index + 1} — {formatDelay(step.delaySeconds)}{" "}
                    {sequence.triggerType === "DATE_FIELD"
                      ? "before the appointment"
                      : index === 0
                        ? "after enrollment"
                        : "after previous step"}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.subject}</p>
                </div>
                {!locked && (
                  <div className="flex items-center gap-1">
                    <StepFormDialog
                      sequenceId={sequenceId}
                      step={step}
                      isFirstStep={index === 0}
                      triggerType={sequence.triggerType}
                      onSaved={load}
                      trigger={
                        <Button variant="ghost" size="icon">
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteStep(step)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!locked && (
            <div>
              <StepFormDialog
                sequenceId={sequenceId}
                isFirstStep={sequence.steps.length === 0}
                triggerType={sequence.triggerType}
                onSaved={load}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="enrollments">
          <EnrollmentsPanel sequenceId={sequenceId} stepCount={sequence.steps.length} />
        </TabsContent>
      </Tabs>

      <div>
        <Button variant="ghost" onClick={() => router.push("/sequences")}>
          Back to sequences
        </Button>
      </div>

      <AlertDialog open={Boolean(deleteStep)} onOpenChange={(o) => !o && setDeleteStep(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this step?</AlertDialogTitle>
            <AlertDialogDescription>
              Remaining steps will shift up to fill the gap. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStep}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
