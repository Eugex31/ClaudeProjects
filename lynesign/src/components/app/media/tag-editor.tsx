"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { updateAsset } from "@/app/(app)/media/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface TagEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  assetName: string;
  tags: string[];
  onDone?: () => void;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

/**
 * Controlled dialog for editing an asset's tags. Tags are added on Enter or
 * comma, shown as removable chips, and saved through {@link updateAsset}, which
 * does the authoritative trimming and de-duping. A returned `{ error }` is shown
 * as a toast; a success refreshes the page.
 */
export function TagEditor({
  open,
  onOpenChange,
  assetId,
  assetName,
  tags,
  onDone,
}: TagEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<string[]>(tags);
  const [entry, setEntry] = React.useState("");
  const [wasOpen, setWasOpen] = React.useState(open);
  const [pending, startTransition] = React.useTransition();

  // Seed the draft from the asset's tags each time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(tags);
      setEntry("");
    }
  }

  function addEntry() {
    const value = entry.trim();
    if (!value) return;
    if (value.length > MAX_TAG_LENGTH) {
      toast.error(`Tags are ${MAX_TAG_LENGTH} characters or less.`);
      return;
    }
    if (draft.includes(value)) {
      setEntry("");
      return;
    }
    if (draft.length >= MAX_TAGS) {
      toast.error(`You can add up to ${MAX_TAGS} tags.`);
      return;
    }
    setDraft([...draft, value]);
    setEntry("");
  }

  function removeTag(tag: string) {
    setDraft(draft.filter((t) => t !== tag));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addEntry();
    } else if (event.key === "Backspace" && entry === "" && draft.length > 0) {
      setDraft(draft.slice(0, -1));
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateAsset(assetId, { tags: draft });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tags saved.");
      onOpenChange(false);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tags for {assetName}</DialogTitle>
          <DialogDescription>
            Tags make an item easier to find. Press Enter to add each one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-entry">Add a tag</Label>
            <Input
              id="tag-entry"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={addEntry}
              autoFocus
              maxLength={MAX_TAG_LENGTH}
            />
          </div>
          {draft.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {draft.map((tag) => (
                <li
                  key={tag}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-hairline",
                    "bg-muted px-2 py-0.5 text-xs text-body",
                  )}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                    className="text-muted-foreground hover:text-ink"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No tags yet.</p>
          )}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save tags"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
