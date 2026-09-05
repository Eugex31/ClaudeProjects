"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export type Tag = { id: string; name: string };

export function TagMultiSelect({
  selected,
  onChange,
}: {
  selected: Tag[];
  onChange: (tags: Tag[]) => void;
}) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/tags")
      .then((r) => r.json())
      .then((body) => setAllTags((body.tags ?? []).map((t: Tag & { contactCount: number }) => ({ id: t.id, name: t.name }))));
  }, [open]);

  const selectedIds = new Set(selected.map((t) => t.id));

  function toggle(tag: Tag) {
    if (selectedIds.has(tag.id)) {
      onChange(selected.filter((t) => t.id !== tag.id));
    } else {
      onChange([...selected, tag]);
    }
  }

  async function createAndSelect() {
    const name = newTagName.trim();
    if (!name) return;
    setCreating(true);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCreating(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to create tag");
      return;
    }
    const { tag } = await res.json();
    setAllTags((t) => [...t, tag]);
    onChange([...selected, tag]);
    setNewTagName("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {selected.map((tag) => (
          <Badge key={tag.id} variant="secondary" className="gap-1">
            {tag.name}
            <button type="button" onClick={() => toggle(tag)} aria-label={`Remove ${tag.name}`}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs">
              <Plus className="mr-1 size-3" />
              Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="flex flex-col gap-1">
              {allTags.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">No tags yet — create one below.</p>
              ) : (
                allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox checked={selectedIds.has(tag.id)} onCheckedChange={() => toggle(tag)} />
                    {tag.name}
                  </label>
                ))
              )}
              <div className="mt-1 flex items-center gap-1 border-t pt-2">
                <Input
                  placeholder="New tag name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndSelect();
                    }
                  }}
                  className="h-7 text-sm"
                />
                <Button type="button" size="sm" className="h-7 px-2" disabled={creating || !newTagName.trim()} onClick={createAndSelect}>
                  Add
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
