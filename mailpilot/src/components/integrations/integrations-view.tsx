"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const CONTACT_FIELDS = [
  { value: "email", label: "Email (required)" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "company", label: "Company" },
  { value: "jobTitle", label: "Job title" },
  { value: "website", label: "Website" },
  { value: "greet", label: "Greet" },
  { value: "appointmentAt", label: "Appointment" },
];

type Status = {
  connected: boolean;
  boardId?: string | null;
  boardName?: string | null;
  columnMapping?: Record<string, string> | null;
  syncEnabled?: boolean;
  lastSyncedAt?: string | null;
};

type Board = { id: string; name: string };
type Column = { id: string; title: string; type: string };

export function IntegrationsView() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [crmEnabled, setCrmEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [configuring, setConfiguring] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [statusRes, billingRes] = await Promise.all([
      fetch("/api/integrations/monday"),
      fetch("/api/billing/summary"),
    ]);
    if (statusRes.ok) {
      setStatus(await statusRes.json());
    }
    if (billingRes.ok) {
      const billing = await billingRes.json();
      const plan = billing.plans?.find((p: { key: string }) => p.key === billing.subscription.planKey);
      setCrmEnabled(Boolean(plan?.crmEnabled));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "connect_failed") toast.error("Failed to connect to Monday.com. Try again.");
    if (error === "invalid_state") toast.error("Connection request expired. Try again.");
    if (searchParams.get("connected") === "1") toast.success("Connected to Monday.com");
  }, [searchParams]);

  async function startBoardPicker() {
    setConfiguring(true);
    const res = await fetch("/api/integrations/monday/boards");
    if (res.ok) {
      const data = await res.json();
      setBoards(data.boards);
    } else {
      toast.error("Failed to load Monday.com boards");
    }
  }

  async function selectBoard(board: Board) {
    setSelectedBoard(board);
    setColumns([]);
    setMapping(status?.boardId === board.id ? (status.columnMapping ?? {}) : {});
    const res = await fetch(`/api/integrations/monday/boards/${board.id}/columns`);
    if (res.ok) {
      const data = await res.json();
      setColumns(data.columns);
    } else {
      toast.error("Failed to load columns for that board");
    }
  }

  async function saveMapping() {
    if (!selectedBoard) return;
    if (!mapping.email) {
      toast.error("Map the email field to a column before saving");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/integrations/monday", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId: selectedBoard.id, boardName: selectedBoard.name, columnMapping: mapping }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to save mapping");
      return;
    }
    toast.success("Monday.com board configured");
    setConfiguring(false);
    load();
  }

  async function togglePause() {
    setBusy(true);
    const res = await fetch(`/api/integrations/monday/${status?.syncEnabled ? "pause" : "resume"}`, {
      method: "POST",
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to update sync status");
      return;
    }
    toast.success(status?.syncEnabled ? "Sync paused" : "Sync resumed");
    load();
  }

  async function syncNow() {
    setBusy(true);
    const res = await fetch("/api/integrations/monday/sync-now", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Failed to sync");
      return;
    }
    toast.success(`Syncing ${body.queued} contact${body.queued === 1 ? "" : "s"} to Monday.com`);
  }

  async function disconnect() {
    setBusy(true);
    const res = await fetch("/api/integrations/monday", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success("Disconnected from Monday.com");
    setConfiguring(false);
    load();
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!crmEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Monday.com</CardTitle>
          <CardDescription>
            CRM sync isn&apos;t included on your current plan. Upgrade to Pro or Agency to connect Monday.com.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/billing">View plans</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!status?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Monday.com</CardTitle>
          <CardDescription>Push your contacts to a Monday.com board automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/integrations/monday/connect">Connect Monday.com</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!status.boardId || configuring) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose a board</CardTitle>
          <CardDescription>Pick a Monday.com board and map your contact fields to its columns.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {boards.length === 0 ? (
            <Button onClick={startBoardPicker} disabled={busy}>
              Load boards
            </Button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Board</Label>
              <Select
                value={selectedBoard?.id ?? ""}
                onValueChange={(id) => {
                  const board = boards.find((b) => b.id === id);
                  if (board) selectBoard(board);
                }}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Choose a board" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedBoard && columns.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-sm font-medium">Map fields to columns (values sent as plain text)</div>
              {CONTACT_FIELDS.map((field) => (
                <div key={field.value} className="grid grid-cols-2 items-center gap-3">
                  <Label>{field.label}</Label>
                  <Select
                    value={mapping[field.value] ?? ""}
                    onValueChange={(columnId) => setMapping((m) => ({ ...m, [field.value]: columnId }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not synced" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <div className="flex gap-2">
                <Button onClick={saveMapping} disabled={busy}>
                  Save
                </Button>
                {status.boardId && (
                  <Button variant="ghost" onClick={() => setConfiguring(false)} disabled={busy}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monday.com</CardTitle>
        <CardDescription>
          Syncing to board &quot;{status.boardName}&quot;.{" "}
          {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}.` : "Not synced yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch checked={status.syncEnabled} onCheckedChange={togglePause} disabled={busy} />
          <Label>{status.syncEnabled ? "Sync enabled" : "Sync paused"}</Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={syncNow} disabled={busy}>
            Sync all contacts now
          </Button>
          <Button variant="outline" onClick={startBoardPicker} disabled={busy}>
            Change board / mapping
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={busy}>
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Monday.com?</AlertDialogTitle>
                <AlertDialogDescription>
                  Contacts will stop syncing. Your board and its existing items in Monday.com are untouched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={disconnect}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
