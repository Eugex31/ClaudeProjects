"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type Account = { id: string; platform: "FACEBOOK_PAGE" | "INSTAGRAM_BUSINESS"; displayName: string };

export type SocialPostRecord = {
  id: string;
  socialAccountId: string;
  caption: string;
  mediaImageId: string | null;
};

const PLATFORM_LABEL: Record<Account["platform"], string> = { FACEBOOK_PAGE: "Facebook", INSTAGRAM_BUSINESS: "Instagram" };

export function PostComposerDialog({
  post,
  onSaved,
  trigger,
}: {
  post?: SocialPostRecord;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(post?.id);
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Multiple accounts only make sense when composing a NEW post — one
  // caption + image, posted independently to each selected account (they
  // succeed/fail on their own, e.g. Instagram needs an image and Facebook
  // doesn't). Editing an existing post stays tied to the one account it was
  // already created against, same as before.
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    new Set(post?.socialAccountId ? [post.socialAccountId] : [])
  );
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [mediaImageId, setMediaImageId] = useState<string | null>(post?.mediaImageId ?? null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(
    post?.mediaImageId ? `/api/template-images/${post.mediaImageId}` : null
  );
  const [imagePrompt, setImagePrompt] = useState("");
  const [captionPrompt, setCaptionPrompt] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setSelectedAccountIds(new Set(post?.socialAccountId ? [post.socialAccountId] : []));
      setCaption(post?.caption ?? "");
      setMediaImageId(post?.mediaImageId ?? null);
      setMediaUrl(post?.mediaImageId ? `/api/template-images/${post.mediaImageId}` : null);
      setScheduledAt("");
      fetch("/api/social/meta")
        .then((r) => r.json())
        .then((data) => setAccounts(data.accounts ?? []));
    }
  }

  function toggleAccount(id: string) {
    if (isEdit) return; // locked to the post's original account
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generateCaption() {
    if (!captionPrompt.trim()) {
      toast.error("Describe what the post should say first");
      return;
    }
    setBusy("caption");
    const res = await fetch("/api/ai/generate/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: captionPrompt }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(data.error ?? "Generation failed");
      return;
    }
    setCaption(data.caption);
  }

  async function generateImage() {
    if (!imagePrompt.trim()) {
      toast.error("Describe the image first");
      return;
    }
    setBusy("image");
    const res = await fetch("/api/ai/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: imagePrompt }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(data.error ?? "Generation failed");
      return;
    }
    setMediaImageId(data.id);
    setMediaUrl(data.url);
  }

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/template-images", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(data.error ?? "Upload failed");
      return;
    }
    const src: string = data.data[0].src;
    // POST /api/template-images returns the image's absolute serving URL,
    // shaped for GrapesJS's Asset Manager — the id isn't in the JSON
    // separately, so it's pulled from the URL's own last path segment
    // (a stable format this app controls, not fragile string-guessing).
    const id = src.split("/").pop()!;
    setMediaImageId(id);
    setMediaUrl(src);
    e.target.value = "";
  }

  // Creates (or, when editing, updates) one SocialPost row per selected
  // account — same caption/image, independent rows so each account's
  // status/errors stay its own (matches how the worker and post-now route
  // already treat every SocialPost as a single-account unit).
  async function persistAll(): Promise<string[]> {
    if (selectedAccountIds.size === 0) {
      toast.error("Choose at least one account");
      return [];
    }
    const ids: string[] = [];
    for (const accountId of selectedAccountIds) {
      const payload = { socialAccountId: accountId, caption, mediaImageId };
      const res = await fetch(isEdit ? `/api/social/posts/${post!.id}` : "/api/social/posts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      const accountName = accounts.find((a) => a.id === accountId)?.displayName ?? accountId;
      if (!res.ok) {
        toast.error(`${accountName}: ${data.error ?? "Failed to save post"}`);
        continue;
      }
      ids.push(data.post.id);
    }
    return ids;
  }

  async function saveDraft() {
    setBusy("save");
    const ids = await persistAll();
    setBusy(null);
    if (ids.length === 0) return;
    toast.success(ids.length === 1 ? "Draft saved" : `${ids.length} drafts saved`);
    setOpen(false);
    onSaved();
  }

  async function schedule() {
    if (!scheduledAt) {
      toast.error("Pick a date and time");
      return;
    }
    setBusy("schedule");
    const ids = await persistAll();
    let scheduledCount = 0;
    for (const id of ids) {
      const res = await fetch(`/api/social/posts/${id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to schedule");
        continue;
      }
      scheduledCount++;
    }
    setBusy(null);
    if (scheduledCount === 0) return;
    toast.success(scheduledCount === 1 ? "Post scheduled" : `${scheduledCount} posts scheduled`);
    setOpen(false);
    onSaved();
  }

  async function postNow() {
    setBusy("post-now");
    const ids = await persistAll();
    for (const id of ids) {
      const res = await fetch(`/api/social/posts/${id}/post-now`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to post");
        continue;
      }
      const accountName = accounts.find((a) => a.id === data.post.socialAccountId)?.displayName ?? "Post";
      if (data.post.status === "FAILED") {
        toast.error(`${accountName}: ${data.post.errorMessage ?? "Posting failed"}`);
      } else {
        toast.success(`${accountName}: Posted`);
      }
    }
    setBusy(null);
    setOpen(false);
    onSaved();
  }

  const selectedAccounts = accounts.filter((a) => selectedAccountIds.has(a.id));
  const needsImage = selectedAccounts.some((a) => a.platform === "INSTAGRAM_BUSINESS");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? <Button>New post</Button>}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit post" : "New post"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Compose a caption and image, then save as a draft, schedule it, or post now."
              : "Compose a caption and image, pick one or more accounts, then save as a draft, schedule, or post now to all of them."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{isEdit ? "Account" : "Accounts"}</Label>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No connected accounts yet — connect one on the Accounts tab first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {accounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-3 rounded-md border p-2.5 text-sm has-[:disabled]:opacity-60"
                  >
                    <Checkbox
                      checked={selectedAccountIds.has(a.id)}
                      onCheckedChange={() => toggleAccount(a.id)}
                      disabled={isEdit && !selectedAccountIds.has(a.id)}
                    />
                    {a.displayName} ({PLATFORM_LABEL[a.platform]})
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Caption</Label>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
            <div className="flex items-center gap-2">
              <Input
                value={captionPrompt}
                onChange={(e) => setCaptionPrompt(e.target.value)}
                placeholder="Describe the post (AI caption)"
                className="h-8 text-xs"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={generateCaption} disabled={busy === "caption"}>
                <Sparkles className="mr-1.5 size-3.5" />
                Generate
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Image {needsImage && "(required for Instagram)"}</Label>
            {mediaUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl} alt="" className="max-h-48 rounded-md border object-cover" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Describe the image (AI generate)"
                className="h-8 text-xs"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={generateImage} disabled={busy === "image"}>
                <Sparkles className="mr-1.5 size-3.5" />
                Generate
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" asChild disabled={busy === "upload"}>
                <label>
                  <Upload className="mr-1.5 size-3.5" />
                  Upload
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={uploadImage} />
                </label>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-at">Schedule for (optional)</Label>
            <Input id="schedule-at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={saveDraft} disabled={busy !== null}>
            Save draft
          </Button>
          <Button variant="outline" onClick={schedule} disabled={busy !== null}>
            Schedule
          </Button>
          <Button onClick={postNow} disabled={busy !== null}>
            Post now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
