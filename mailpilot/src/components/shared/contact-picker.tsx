"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Contact = { id: string; firstName: string | null; lastName: string | null; email: string };
type Tag = { id: string; name: string };

const ALL_TAGS = "all";

// Shared search + tag-filter + select-all-filtered + checkbox-list contact
// picker, used by both AddRecipientsDialog (campaigns) and AddEnrollmentsDialog
// (sequences) — same interaction, different destination for the chosen ids.
export function ContactPicker({
  open,
  selected,
  onSelectedChange,
}: {
  open: boolean;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const [tagId, setTagId] = useState(ALL_TAGS);
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ page: "1", pageSize: "100" });
    if (q) params.set("q", q);
    if (tagId !== ALL_TAGS) params.set("tagId", tagId);
    fetch(`/api/contacts?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []));
  }, [open, q, tagId]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  const allFilteredSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  function toggleSelectAllFiltered() {
    const next = new Set(selected);
    if (allFilteredSelected) {
      for (const c of contacts) next.delete(c.id);
    } else {
      for (const c of contacts) next.add(c.id);
    }
    onSelectedChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Search contacts..." className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={tagId} onValueChange={setTagId}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TAGS}>All tags</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {contacts.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-muted-foreground">
          <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAllFiltered} />
          Select all {contacts.length} filtered
        </label>
      )}
      <ScrollArea className="h-72 rounded-md border">
        <div className="flex flex-col p-2">
          {contacts.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No contacts found.</p>
          ) : (
            contacts.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                <span>
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}{" "}
                  <span className="text-muted-foreground">{c.email}</span>
                </span>
              </label>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
