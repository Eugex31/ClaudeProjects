"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tag as TagIcon, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
} from "@/components/ui/alert-dialog";

type TagRow = { id: string; name: string; contactCount: number };

export function ManageTagsDialog({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null);

  function load() {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((body) => setTags(body.tags ?? []));
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function rename(id: string) {
    const name = editingName.trim();
    if (!name) return;
    const res = await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to rename tag");
      return;
    }
    setEditingId(null);
    load();
    onChanged?.();
  }

  async function remove() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/tags/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (!res.ok) {
      toast.error("Failed to delete tag");
      return;
    }
    load();
    onChanged?.();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <TagIcon className="mr-1.5 size-3.5" />
            Manage tags
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Manage tags</DialogTitle>
            <DialogDescription>Rename or delete tags. Deleting a tag untags its contacts.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {tags.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No tags yet.</p>
            ) : (
              tags.map((tag) => (
                <div key={tag.id} className="flex items-center gap-2 rounded-sm px-1 py-1.5">
                  {editingId === tag.id ? (
                    <>
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="h-7 text-sm"
                        onKeyDown={(e) => e.key === "Enter" && rename(tag.id)}
                      />
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => rename(tag.id)}>
                        <Check className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditingId(null)}>
                        <X className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{tag.name}</span>
                      <span className="text-xs text-muted-foreground">{tag.contactCount}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => {
                          setEditingId(tag.id);
                          setEditingName(tag.name);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        onClick={() => setDeleteTarget(tag)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes this tag from {deleteTarget?.contactCount ?? 0} contact
              {deleteTarget?.contactCount === 1 ? "" : "s"}. The contacts themselves aren&apos;t affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
