"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

type SequenceRow = {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  activeEnrollmentCount: number;
};

const TRIGGER_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  TAG_ADDED: "Tag added",
  CONTACT_CREATED: "Contact created",
};

export function SequencesTable({ refreshSignal }: { refreshSignal?: number } = {}) {
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SequenceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/sequences");
    if (res.ok) {
      const data = await res.json();
      setSequences(data.sequences);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshSignal]);

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/sequences/${deleteTarget.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete sequence");
    } else {
      toast.success("Sequence deleted");
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
            <TableHead>Status</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Active enrollments</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : sequences.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                No sequences yet.
              </TableCell>
            </TableRow>
          ) : (
            sequences.map((sequence) => (
              <TableRow key={sequence.id}>
                <TableCell>
                  <Link href={`/sequences/${sequence.id}`} className="font-medium hover:underline">
                    {sequence.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={sequence.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{TRIGGER_LABELS[sequence.triggerType]}</TableCell>
                <TableCell>{sequence.activeEnrollmentCount}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/sequences/${sequence.id}`}>Open</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(sequence)}>
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
            <AlertDialogTitle>Delete this sequence?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; and all its steps and enrollments will be permanently removed. This
              can&apos;t be undone.
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
