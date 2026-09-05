"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewFolderDialog } from "@/components/app/media/new-folder-dialog";
import { AddWebContentDialog } from "@/components/app/media/add-web-content-dialog";

export interface MediaToolbarProps {
  q: string;
  kind: string;
  sort: string;
  canCreate: boolean;
  canManageFolders: boolean;
  parentId: string | null;
  onUpload: () => void;
}

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const KIND_OPTIONS = [
  { value: "", label: "All types" },
  { value: "IMAGE", label: "Images" },
  { value: "VIDEO", label: "Videos" },
  { value: "WEB", label: "Web" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name A to Z" },
  { value: "name_desc", label: "Name Z to A" },
  { value: "largest", label: "Largest" },
];

/**
 * Filter and action row for the media library. Search is debounced into the `q`
 * search param; kind and sort write their params immediately. Every change drops
 * the `page` param so the result set restarts at page one. "Upload" defers to
 * the parent (it owns the hidden file input); "New folder" and "Add web
 * content" are their own dialogs.
 */
export function MediaToolbar({
  q,
  kind,
  sort,
  canCreate,
  canManageFolders,
  parentId,
  onUpload,
}: MediaToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = React.useState(q);
  const [syncedQ, setSyncedQ] = React.useState(q);

  // Reflect an external `q` change (back/forward, a cleared filter) into the
  // input. Adjusting state during render is the supported pattern for this;
  // an effect here would be a cascading render.
  if (q !== syncedQ) {
    setSyncedQ(q);
    setTerm(q);
  }

  const pushParam = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    if (term === q) return;
    const handle = setTimeout(() => pushParam("q", term.trim()), 300);
    return () => clearTimeout(handle);
  }, [term, q, pushParam]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search name or tag"
          aria-label="Search media"
          className="pl-8"
        />
      </div>

      <label className="sr-only" htmlFor="media-kind">
        Filter by type
      </label>
      <select
        id="media-kind"
        value={kind}
        onChange={(event) => pushParam("kind", event.target.value)}
        className={SELECT_CLASS}
      >
        {KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="media-sort">
        Sort
      </label>
      <select
        id="media-sort"
        value={sort}
        onChange={(event) => pushParam("sort", event.target.value)}
        className={SELECT_CLASS}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {canManageFolders ? <NewFolderDialog parentId={parentId} /> : null}
      {canCreate ? <AddWebContentDialog /> : null}
      {canCreate ? (
        <Button size="sm" onClick={onUpload}>
          <Upload aria-hidden />
          Upload
        </Button>
      ) : null}
    </div>
  );
}
