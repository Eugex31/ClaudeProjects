"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AddRecipientsDialog } from "@/components/campaigns/add-recipients-dialog";
import { Pagination } from "@/components/shared/pagination";

type Recipient = {
  id: string;
  contact: { id: string; firstName: string | null; lastName: string | null; email: string; company: string | null };
};

export function RecipientsPanel({
  campaignId,
  locked,
  onTotalChange,
}: {
  campaignId: string;
  locked: boolean;
  onTotalChange?: (total: number) => void;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;
  const onTotalChangeRef = useRef(onTotalChange);
  useEffect(() => {
    onTotalChangeRef.current = onTotalChange;
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/campaigns/${campaignId}/recipients?page=${page}&pageSize=${pageSize}`);
    if (res.ok) {
      const data = await res.json();
      setRecipients(data.recipients);
      setTotal(data.total);
      onTotalChangeRef.current?.(data.total);
    }
    setLoading(false);
  }, [campaignId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleRemove(recipientId: string) {
    const res = await fetch(`/api/campaigns/${campaignId}/recipients/${recipientId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to remove recipient");
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{total} recipient{total === 1 ? "" : "s"}</p>
        {!locked && <AddRecipientsDialog campaignId={campaignId} onAdded={load} />}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              {!locked && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ) : recipients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No recipients yet. Add contacts to this campaign before starting it.
                </TableCell>
              </TableRow>
            ) : (
              recipients.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell>{r.contact.email}</TableCell>
                  <TableCell>{r.contact.company || "—"}</TableCell>
                  {!locked && (
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleRemove(r.id)}>
                        <X className="size-4" />
                      </Button>
                    </TableCell>
                  )}
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
