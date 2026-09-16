"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type AuditEntry = {
  id: string;
  adminEmail: string;
  action: string;
  details: string | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  SUSPEND: "Deactivated",
  REACTIVATE: "Activated",
  CANCEL_SUBSCRIPTION: "Canceled subscription",
  DELETE: "Deleted account",
  NOTIFY: "Sent notification",
  ASSIGN_PLAN: "Assigned plan",
};

export function CustomerAuditLog({ customerId }: { customerId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/customers/${customerId}/audit-log`)
      .then((r) => r.json())
      .then((body) => {
        setEntries(body.entries ?? []);
        setLoading(false);
      });
  }, [customerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Every admin action taken on this account, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 border-b pb-3 text-sm last:border-b-0">
                <div>
                  <p className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</p>
                  <p className="text-muted-foreground">
                    by {entry.adminEmail}
                    {entry.details ? ` — ${entry.details}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
