"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
import { NewsletterFormDialog, type NewsletterRecord } from "@/components/newsletters/newsletter-form-dialog";

type NewsletterRow = NewsletterRecord & {
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  nextRunAt: string | null;
  template: { name: string };
  targetTag: { name: string } | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function recurrenceSummary(n: NewsletterRow): string {
  const time = `${pad(n.hourUtc)}:${pad(n.minuteUtc)} UTC`;
  if (n.frequency === "WEEKLY") {
    return `Weekly, ${WEEKDAYS[n.dayOfWeek ?? 0]} ${time}`;
  }
  return `Monthly, day ${n.dayOfMonth ?? 1} ${time}`;
}

export function NewslettersTable({ refreshSignal }: { refreshSignal?: number } = {}) {
  const [newsletters, setNewsletters] = useState<NewsletterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<NewsletterRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/newsletters");
    if (res.ok) {
      const data = await res.json();
      setNewsletters(data.newsletters);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshSignal]);

  async function toggleActive(n: NewsletterRow) {
    setBusyId(n.id);
    const res = await fetch(`/api/newsletters/${n.id}/${n.status === "ACTIVE" ? "pause" : "activate"}`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error(body.error ?? "Failed to update newsletter");
      return;
    }
    toast.success(n.status === "ACTIVE" ? "Newsletter paused" : "Newsletter activated");
    load();
  }

  async function sendNow(n: NewsletterRow) {
    setBusyId(n.id);
    const res = await fetch(`/api/newsletters/${n.id}/send-now`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error(body.error ?? "Failed to send");
      return;
    }
    toast.success("Sent — check Campaigns for progress");
    load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/newsletters/${deleteTarget.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete newsletter");
    } else {
      toast.success("Newsletter deleted");
      load();
    }
    setDeleteTarget(null);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Send to</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : newsletters.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                No newsletters yet.
              </TableCell>
            </TableRow>
          ) : (
            newsletters.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-medium">{n.name}</TableCell>
                <TableCell className="text-muted-foreground">{n.template.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {n.targetTag ? `Tagged "${n.targetTag.name}"` : "All contacts"}
                </TableCell>
                <TableCell className="text-muted-foreground">{recurrenceSummary(n)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {n.nextRunAt ? new Date(n.nextRunAt).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={n.status} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={busyId === n.id}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <NewsletterFormDialog
                        newsletter={n}
                        onSaved={load}
                        trigger={
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Edit</DropdownMenuItem>
                        }
                      />
                      <DropdownMenuItem onSelect={() => toggleActive(n)}>
                        {n.status === "ACTIVE" ? "Pause" : "Activate"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => sendNow(n)}>Send now</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(n)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this newsletter?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; will stop sending. Campaigns it already created are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
