"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Mail, CheckCircle2, XCircle, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

type Profile = {
  id: string;
  label: string;
  createdAt: string;
  contactCount: number;
  campaignCount: number;
  gmailConnected: boolean;
};

export function ProfilesView() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/profiles");
    if (res.ok) setProfiles((await res.json()).profiles);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function createProfile() {
    if (!newLabel.trim()) return;
    setBusy(true);
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setLimitMessage(err.error ?? "You've reached your plan's managed profile limit.");
        return;
      }
      toast.error(err.error ?? "Failed to create profile");
      return;
    }
    setCreateOpen(false);
    setNewLabel("");
    setLimitMessage(null);
    toast.success("Profile created");
    load();
  }

  async function rename(id: string) {
    if (!renameValue.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: renameValue.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to rename profile");
      return;
    }
    setRenamingId(null);
    toast.success("Profile renamed");
    load();
  }

  async function deleteProfile(id: string) {
    setBusy(true);
    const res = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to delete profile");
      return;
    }
    toast.success("Profile deleted");
    load();
  }

  async function manage(id: string) {
    setBusy(true);
    const res = await fetch(`/api/profiles/${id}/switch`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to switch into this profile");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (profiles === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (next) setLimitMessage(null);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 size-4" />
              New profile
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New client profile</DialogTitle>
              <DialogDescription>
                A separate workspace — its own contacts, campaigns, templates, and Gmail connection. Nothing here is
                shared with your own account.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-label">Client name</Label>
              <Input
                id="profile-label"
                placeholder="Acme Corp"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              {limitMessage && <p className="text-sm text-destructive">{limitMessage}</p>}
            </div>
            <DialogFooter>
              <Button onClick={createProfile} disabled={busy || !newLabel.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No client profiles yet. Create one to manage a client&apos;s campaigns, contacts, and Gmail sending
            separately from your own account.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                {renamingId === p.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8" />
                    <Button size="sm" onClick={() => rename(p.id)} disabled={busy}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <>
                    <CardTitle className="text-base">{p.label}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setRenamingId(p.id);
                        setRenameValue(p.label);
                      }}
                      title="Rename"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {p.gmailConnected ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-green-600" /> Gmail connected
                    </>
                  ) : (
                    <>
                      <XCircle className="size-3.5" /> No Gmail connected
                    </>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {p.contactCount.toLocaleString()} contacts · {p.campaignCount.toLocaleString()} campaigns
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => manage(p.id)} disabled={busy} className="flex-1">
                    <Mail className="mr-1.5 size-3.5" />
                    Manage
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {p.label}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes every contact, campaign, template, and sequence in this
                          client&apos;s workspace. This can&apos;t be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteProfile(p.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
