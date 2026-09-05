"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { Pagination } from "@/components/shared/pagination";
import { AddEnrollmentsDialog } from "@/components/sequences/add-enrollments-dialog";

type Enrollment = {
  id: string;
  status: string;
  currentStep: number;
  nextSendAt: string | null;
  contact: { firstName: string | null; lastName: string | null; email: string };
};

export function EnrollmentsPanel({ sequenceId, stepCount }: { sequenceId: string; stepCount: number }) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/sequences/${sequenceId}/enrollments?page=${page}&pageSize=${pageSize}`);
    if (res.ok) {
      const data = await res.json();
      setEnrollments(data.enrollments);
      setTotal(data.total);
    }
    setLoading(false);
  }, [sequenceId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleRemove(enrollmentId: string) {
    const res = await fetch(`/api/sequences/${sequenceId}/enrollments/${enrollmentId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to remove enrollment");
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{total} enrolled</p>
        <AddEnrollmentsDialog sequenceId={sequenceId} onAdded={load} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ) : enrollments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No enrollments yet.
                </TableCell>
              </TableRow>
            ) : (
              enrollments.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div>{[e.contact.firstName, e.contact.lastName].filter(Boolean).join(" ") || "—"}</div>
                    <div className="text-xs text-muted-foreground">{e.contact.email}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                  <TableCell>
                    {e.currentStep} / {stepCount}
                  </TableCell>
                  <TableCell>
                    {e.status === "ACTIVE" && (
                      <Button variant="ghost" size="icon" onClick={() => handleRemove(e.id)}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </div>
  );
}
