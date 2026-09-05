"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ContactPicker } from "@/components/shared/contact-picker";

export function AddRecipientsDialog({ campaignId, onAdded }: { campaignId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    if (selected.size === 0) return;
    setSubmitting(true);
    const res = await fetch(`/api/campaigns/${campaignId}/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: Array.from(selected) }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to add recipients");
      return;
    }
    const { added } = await res.json();
    toast.success(`Added ${added} recipient${added === 1 ? "" : "s"}`);
    setSelected(new Set());
    setOpen(false);
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="mr-1.5 size-3.5" />
          Add recipients
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add recipients</DialogTitle>
          <DialogDescription>Select contacts to add to this campaign.</DialogDescription>
        </DialogHeader>
        <ContactPicker open={open} selected={selected} onSelectedChange={setSelected} />
        <DialogFooter>
          <Button onClick={handleAdd} disabled={submitting || selected.size === 0}>
            Add {selected.size > 0 ? selected.size : ""} recipient{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
