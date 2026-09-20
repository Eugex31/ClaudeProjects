"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

type Account = { id: string; platform: "FACEBOOK_PAGE" | "INSTAGRAM_BUSINESS"; displayName: string; connectedAt: string };
type Status = { connected: boolean; accounts: Account[] };
type Page = {
  pageId: string;
  pageName: string;
  alreadyConnected: boolean;
  instagram: { id: string; username: string; alreadyConnected: boolean } | null;
};

const PLATFORM_LABEL: Record<Account["platform"], string> = {
  FACEBOOK_PAGE: "Facebook Page",
  INSTAGRAM_BUSINESS: "Instagram",
};

export function MetaConnectionView() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const [picking, setPicking] = useState(false);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/social/meta");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "connect_failed") toast.error("Failed to connect to Facebook. Try again.");
    if (error === "invalid_state") toast.error("Connection request expired. Try again.");
    if (searchParams.get("connected") === "1") toast.success("Connected to Facebook");
  }, [searchParams]);

  async function startPagePicker() {
    setPicking(true);
    setBusy(true);
    const res = await fetch("/api/social/meta/pages");
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to load Facebook Pages");
      return;
    }
    setPages(data.pages);
    setSelected(new Set(data.pages.filter((p: Page) => p.alreadyConnected).map((p: Page) => p.pageId)));
  }

  function toggle(pageId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  async function activate() {
    if (selected.size === 0) {
      toast.error("Select at least one page");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/social/meta/pages/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds: Array.from(selected) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to activate pages");
      return;
    }
    toast.success(`Activated ${data.activated} page${data.activated === 1 ? "" : "s"}`);
    setPicking(false);
    load();
  }

  async function removeAccount(id: string) {
    setBusy(true);
    const res = await fetch(`/api/social/accounts/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success("Disconnected");
    load();
  }

  async function disconnectAll() {
    setBusy(true);
    const res = await fetch("/api/social/meta", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success("Disconnected from Facebook");
    load();
  }

  if (status === null) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!status.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Facebook &amp; Instagram</CardTitle>
          <CardDescription>Connect a Facebook account to post to your Pages and linked Instagram Business accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/social/meta/connect">Connect Facebook &amp; Instagram</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (picking) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose pages</CardTitle>
          <CardDescription>Select which Facebook Pages (and their linked Instagram accounts) to activate for posting.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pages === null ? (
            <Skeleton className="h-16 w-full" />
          ) : pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Facebook Pages found for this account.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pages.map((p) => (
                <div key={p.pageId} className="flex items-center gap-3 rounded-md border p-3">
                  <Checkbox checked={selected.has(p.pageId)} onCheckedChange={() => toggle(p.pageId)} disabled={busy} />
                  <div>
                    <div className="text-sm font-medium">{p.pageName}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.instagram ? `Includes Instagram @${p.instagram.username}` : "No linked Instagram account"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={activate} disabled={busy || pages === null}>
              Activate selected
            </Button>
            <Button variant="ghost" onClick={() => setPicking(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>Posts you create can be published to any of these.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connected to Facebook, but no pages activated yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {status.accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{a.displayName}</span>
                  <Badge variant="outline">{PLATFORM_LABEL[a.platform]}</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeAccount(a.id)} disabled={busy}>
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={startPagePicker} disabled={busy}>
            {status.accounts.length === 0 ? "Choose pages" : "Add / update pages"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={busy}>
                Disconnect everything
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Facebook &amp; Instagram?</AlertDialogTitle>
                <AlertDialogDescription>
                  All connected pages and Instagram accounts will stop being available for posting. Nothing on Facebook or Instagram itself is affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={disconnectAll}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
