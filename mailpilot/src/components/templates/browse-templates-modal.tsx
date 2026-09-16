"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, LayoutGrid, List, RefreshCw, Star, Pencil, MoreHorizontal, Download, Sparkles, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { TemplateFormDialog, type TemplateRecord } from "@/components/templates/template-form-dialog";

type ViewMode = "grid" | "list";
const VIEW_MODE_KEY = "templates.browseViewMode";
type Tab = "starter" | "mine";

type Item = {
  id: string;
  name: string;
  subject: string;
  body: string;
  bodyFormat: "RICH_TEXT" | "HTML";
  categoryId: string | null;
  isFavorite: boolean;
};

type CategoryOption = { id: string; key: string; label: string; count: number };

export function BrowseTemplatesModal({
  onSelect,
  trigger,
  footerTip,
}: {
  onSelect: (template: { subject: string; body: string; bodyFormat: "RICH_TEXT" | "HTML"; name?: string; id?: string }) => void;
  trigger?: React.ReactNode;
  footerTip?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("starter");
  const [selectedCategory, setSelectedCategory] = useState("all"); // "all" | "starred" | a real categoryId
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [allCount, setAllCount] = useState(0);
  const [starredCount, setStarredCount] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [editingCopy, setEditingCopy] = useState<TemplateRecord | null>(null);
  const [limitInfo, setLimitInfo] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "grid" || stored === "list") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewMode(stored);
    }
  }, []);

  function setAndPersistViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  // Takes the just-fetched count as a param rather than reading allCount from
  // state, so callers that already have a fresh count (loadCategories) don't
  // race against that state update landing.
  const loadLimitInfo = useCallback(async (usedCount: number) => {
    const res = await fetch("/api/billing/summary");
    if (!res.ok) return;
    const data = await res.json();
    const plan = data.plans?.find((p: { key: string }) => p.key === data.subscription.planKey);
    if (plan) setLimitInfo({ used: usedCount, limit: plan.templateLimit });
  }, []);

  const loadCategories = useCallback(async () => {
    const res = await fetch(`/api/template-categories?tab=${tab}`);
    if (!res.ok) return;
    const data = await res.json();
    setCategories(data.categories);
    setAllCount(data.all.count);
    setStarredCount(data.starred.count);
    if (tab === "mine") await loadLimitInfo(data.all.count);
  }, [tab, loadLimitInfo]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedCategory === "starred") {
      params.set("starred", "true");
    } else if (selectedCategory !== "all") {
      params.set("categoryId", selectedCategory);
    }
    if (search.trim()) params.set("search", search.trim());
    const url = tab === "starter" ? `/api/starter-templates?${params}` : `/api/templates?${params}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setItems(data.templates);
    }
    setLoading(false);
  }, [tab, selectedCategory, search]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCategories();
  }, [open, loadCategories]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems();
  }, [open, loadItems]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTab("starter");
      setSelectedCategory("all");
      setSearch("");
    }
  }

  function handleTabChange(next: string) {
    setTab(next as Tab);
    setSelectedCategory("all");
    setSearch("");
  }

  function refreshAll() {
    loadCategories();
    loadItems();
  }

  function handleUse(item: Item) {
    // Only pass the source id for an already-owned "My Templates" row — a
    // caller that opens an edit form from this (the Templates page) then
    // knows to PATCH that same template ("Save changes") instead of always
    // creating a new copy. Starter templates never carry an id through here:
    // they're shared, read-only content, so "Use" from that tab must still
    // result in a new owned row, same as it always has.
    onSelect({
      subject: item.subject,
      body: item.body,
      bodyFormat: item.bodyFormat,
      name: item.name,
      id: tab === "mine" ? item.id : undefined,
    });
    setOpen(false);
    // Generic on purpose: this modal is also opened from the campaign
    // builder and sequence-step dialog, where "Use" loads content into that
    // form, not into a template edit dialog — the `id` above is caller-
    // specific behavior BrowseTemplatesModal itself shouldn't narrate.
    toast.success("Template loaded — remember to save");
  }

  async function handleToggleFavorite(item: Item) {
    const url =
      tab === "starter" ? `/api/starter-templates/${item.id}/favorite` : `/api/templates/${item.id}/favorite`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to update favorite");
      return;
    }
    refreshAll();
  }

  async function handleEdit(item: Item) {
    if (tab === "mine") {
      setEditingCopy(item);
      return;
    }
    const res = await fetch(`/api/starter-templates/${item.id}/copy`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to open template for editing");
      return;
    }
    setEditingCopy(body.template);
  }

  // Same ownership branch as handleEdit above: opening a starter template in
  // the visual editor first copies it into the customer's own Template row
  // (never touching the shared StarterTemplate) — the editor itself only
  // ever operates on an owned row.
  async function handleOpenVisualEditor(item: Item) {
    if (tab === "mine") {
      router.push(`/templates/${item.id}/editor`);
      return;
    }
    const res = await fetch(`/api/starter-templates/${item.id}/copy`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to open template for editing");
      return;
    }
    router.push(`/templates/${body.template.id}/editor`);
  }

  async function handleDuplicate(item: Item) {
    const res = await fetch(`/api/templates/${item.id}/duplicate`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to duplicate template");
      return;
    }
    toast.success("Template duplicated");
    refreshAll();
  }

  async function handleRename(item: Item, name: string) {
    const res = await fetch(`/api/templates/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error("Failed to rename template");
      return;
    }
    refreshAll();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/templates/${deleteTarget.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to delete template");
    } else {
      toast.success("Template deleted");
      refreshAll();
    }
    setDeleteTarget(null);
  }

  const showUpgradeNudge = tab === "mine" && limitInfo && limitInfo.limit !== -1 && limitInfo.used >= limitInfo.limit;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
              Browse templates
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-4xl">
          <DialogHeader className="flex-row items-center justify-between space-y-0 pr-6">
            <DialogTitle>Browse templates</DialogTitle>
            {showUpgradeNudge && (
              <a
                href="/billing"
                className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline dark:text-amber-400"
              >
                <Sparkles className="size-3.5" />
                Upgrade for more templates
              </a>
            )}
          </DialogHeader>

          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="starter">Free Templates</TabsTrigger>
              <TabsTrigger value="mine">My Templates</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-56 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ({allCount})</SelectItem>
                <SelectItem value="starred">Starred ({starredCount})</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} ({c.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setAndPersistViewMode(viewMode === "grid" ? "list" : "grid")}
              title={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
            >
              {viewMode === "grid" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={refreshAll} title="Refresh">
              <RefreshCw className="size-4" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No templates found.</p>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {items.map((item) => (
                  <TemplateGridCard
                    key={item.id}
                    item={item}
                    tab={tab}
                    onUse={() => handleUse(item)}
                    onFavorite={() => handleToggleFavorite(item)}
                    onEdit={() => handleEdit(item)}
                    onOpenVisualEditor={() => handleOpenVisualEditor(item)}
                    onDuplicate={tab === "mine" ? () => handleDuplicate(item) : undefined}
                    onRename={tab === "mine" ? (name) => handleRename(item, name) : undefined}
                    onDelete={tab === "mine" ? () => setDeleteTarget(item) : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col divide-y rounded-md border">
                {items.map((item) => (
                  <TemplateListRow
                    key={item.id}
                    item={item}
                    tab={tab}
                    onUse={() => handleUse(item)}
                    onFavorite={() => handleToggleFavorite(item)}
                    onEdit={() => handleEdit(item)}
                    onOpenVisualEditor={() => handleOpenVisualEditor(item)}
                    onDuplicate={tab === "mine" ? () => handleDuplicate(item) : undefined}
                    onRename={tab === "mine" ? (name) => handleRename(item, name) : undefined}
                    onDelete={tab === "mine" ? () => setDeleteTarget(item) : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {footerTip ?? "Tip: use the category dropdown and search to quickly find the right template."}
          </div>
        </DialogContent>
      </Dialog>

      {editingCopy && (
        <TemplateFormDialog
          template={editingCopy}
          open={Boolean(editingCopy)}
          onOpenChange={(o) => {
            if (!o) {
              setEditingCopy(null);
              refreshAll();
            }
          }}
          trigger={null}
          onSaved={() => {
            setEditingCopy(null);
            refreshAll();
          }}
        />
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; will be permanently removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type ItemActionHandlers = {
  item: Item;
  tab: Tab;
  onUse: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onOpenVisualEditor: () => void;
  onDuplicate?: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
};

function ItemActionIcons({
  item,
  onUse,
  onFavorite,
  onEdit,
  onOpenVisualEditor,
  onDuplicate,
  onDelete,
  onStartRename,
}: ItemActionHandlers & { onStartRename?: () => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon-sm" title="Use this template" onClick={onUse}>
        <Download className="size-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" title="Favorite" onClick={onFavorite}>
        <Star className={cn("size-3.5", item.isFavorite && "fill-amber-400 text-amber-400")} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" title="Edit" onClick={onEdit}>
        <Pencil className="size-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" title="More options">
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpenVisualEditor}>Open in visual editor</DropdownMenuItem>
          {onStartRename && <DropdownMenuItem onSelect={onStartRename}>Rename</DropdownMenuItem>}
          {onDuplicate && (
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="mr-2 size-3.5" />
              Duplicate
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function HtmlFormatBadge() {
  return (
    <span className="mt-1 inline-flex w-fit items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-primary uppercase">
      HTML
    </span>
  );
}

function ItemName({
  item,
  renaming,
  onRename,
  onDoneRenaming,
  className,
}: {
  item: Item;
  renaming: boolean;
  onRename?: (name: string) => void;
  onDoneRenaming: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(item.name);

  if (renaming) {
    return (
      <Input
        autoFocus
        className="h-7 text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onDoneRenaming();
          if (draft.trim() && draft !== item.name) onRename?.(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(item.name);
            onDoneRenaming();
          }
        }}
      />
    );
  }

  return <span className={cn("truncate font-medium", className)}>{item.name}</span>;
}

// A real, live-rendered visual thumbnail — the actual template content
// scaled down to card size via CSS transform, not a text snippet or a badge.
// Works for both formats: a full HTML document renders its real header/hero,
// a rich-text fragment renders as flowing text at the same virtual width —
// either way the card shows what the template actually looks like, matching
// the "grid of real template previews" look of the cloudHQ reference.
function TemplateThumbnail({ item, onUse }: { item: Item; onUse: () => void }) {
  return (
    <button
      type="button"
      onClick={onUse}
      className="block h-32 w-full overflow-hidden rounded border bg-white"
      title="Use this template"
    >
      <div className="relative h-full w-full">
        <iframe
          srcDoc={item.body || "<p style='color:#9ca3af;font-family:sans-serif;padding:16px'>No content</p>"}
          title={item.name}
          tabIndex={-1}
          sandbox="allow-same-origin"
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={{ width: "600px", height: "480px", transform: "scale(0.335)" }}
        />
      </div>
    </button>
  );
}

function TemplateGridCard(props: ItemActionHandlers) {
  const { item } = props;
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <TemplateThumbnail item={item} onUse={props.onUse} />
      <ItemName item={item} renaming={renaming} onRename={props.onRename} onDoneRenaming={() => setRenaming(false)} />
      <ItemActionIcons {...props} onStartRename={props.onRename ? () => setRenaming(true) : undefined} />
    </div>
  );
}

function TemplateListRow(props: ItemActionHandlers) {
  const { item } = props;
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ItemName item={item} renaming={renaming} onRename={props.onRename} onDoneRenaming={() => setRenaming(false)} />
        {!renaming && item.bodyFormat === "HTML" && <HtmlFormatBadge />}
      </div>
      <ItemActionIcons {...props} onStartRename={props.onRename ? () => setRenaming(true) : undefined} />
    </div>
  );
}
