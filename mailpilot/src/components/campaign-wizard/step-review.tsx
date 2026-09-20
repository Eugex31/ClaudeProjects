"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { EmailBodyEditor } from "@/components/campaigns/email-body-editor";
import type { Answers } from "./step-questions";
import type { GeneratedResult, ReviewState, ReviewSocialPost, Service, ConnectedAccount } from "./types";

type DoneLink = { label: string; href: string };

function SocialPostCard({
  post,
  onChange,
  onRemove,
}: {
  post: ReviewSocialPost;
  onChange: (patch: Partial<ReviewSocialPost>) => void;
  onRemove: () => void;
}) {
  const [imagePrompt, setImagePrompt] = useState("");
  const [busy, setBusy] = useState<"image" | "upload" | null>(null);

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
    onChange({ mediaImageId: data.id, mediaUrl: data.url });
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
    onChange({ mediaImageId: src.split("/").pop()!, mediaUrl: src });
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{post.accountLabel}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <X className="size-3.5" />
        </Button>
      </div>
      <Textarea value={post.caption} onChange={(e) => onChange({ caption: e.target.value })} rows={3} />
      {post.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.mediaUrl} alt="" className="max-h-36 rounded-md border object-cover" />
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
  );
}

// /api/contacts caps pageSize at 100 (a sane bound for a list-view UI) — the
// wizard needs every matching contact as the audience, not one page of them,
// so this pages through until exhausted rather than requesting an oversized
// pageSize the route would just reject.
const CONTACTS_PAGE_SIZE = 100;

async function fetchAllContactIds(tagId: string | null): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(CONTACTS_PAGE_SIZE) });
    if (tagId) params.set("tagId", tagId);
    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json().catch(() => ({}));
    const pageContacts: { id: string }[] = data.contacts ?? [];
    ids.push(...pageContacts.map((c) => c.id));
    if (pageContacts.length < CONTACTS_PAGE_SIZE || ids.length >= (data.total ?? ids.length)) break;
    page++;
  }
  return ids;
}

export function StepReview({
  generated,
  answers,
  accounts,
  onDone,
}: {
  generated: GeneratedResult;
  answers: Answers;
  accounts: ConnectedAccount[];
  onDone: (links: DoneLink[]) => void;
}) {
  const [kept, setKept] = useState<Set<Service>>(
    new Set([
      generated.campaign && "campaign",
      generated.sequence && "sequence",
      generated.newsletterTemplate && "newsletter",
      generated.socialPosts && "social",
      generated.template && "template",
    ].filter((s): s is Service => Boolean(s)))
  );
  const [review, setReview] = useState<ReviewState>(() => ({
    campaign: generated.campaign ? { ...generated.campaign, activateNow: false } : undefined,
    sequence: generated.sequence
      ? {
          name: generated.sequence.name,
          activateNow: false,
          steps: generated.sequence.steps.map((s, i) => ({
            ...s,
            delaySeconds: i === 0 ? 0 : generated.sequence!.cadenceDays * 86400,
          })),
        }
      : undefined,
    newsletter: generated.newsletterTemplate ? { ...generated.newsletterTemplate } : undefined,
    socialPosts: generated.socialPosts
      ? generated.socialPosts.flatMap((p) =>
          answers.social.socialAccountIds.map((accountId) => ({
            accountId,
            accountLabel: accounts.find((a) => a.id === accountId)?.displayName ?? accountId,
            caption: p.caption,
            mediaImageId: null,
            mediaUrl: null,
          }))
        )
      : undefined,
    template: generated.template
      ? { name: `AI Template — ${new Date().toLocaleDateString()}`, subject: generated.template.subject, bodyHtml: generated.template.bodyHtml }
      : undefined,
  }));
  const [scheduleSocialNow, setScheduleSocialNow] = useState(false);
  const [creating, setCreating] = useState(false);

  const tabs = (["campaign", "sequence", "newsletter", "social", "template"] as Service[]).filter((s) => kept.has(s));

  function skip(service: Service) {
    setKept((prev) => {
      const next = new Set(prev);
      next.delete(service);
      return next;
    });
  }

  async function approveAndCreate() {
    setCreating(true);
    const links: DoneLink[] = [];
    try {
      let contactIds: string[] | null = null;
      if (kept.has("campaign") || kept.has("sequence")) {
        contactIds = await fetchAllContactIds(answers.common.tagId);
      }

      if (kept.has("campaign") && review.campaign) {
        const createRes = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `AI Campaign — ${new Date().toLocaleDateString()}` }),
        });
        const { campaign } = await createRes.json();
        await fetch(`/api/campaigns/${campaign.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: review.campaign.subject, body: review.campaign.bodyHtml, bodyFormat: "RICH_TEXT" }),
        });
        if (contactIds && contactIds.length > 0) {
          await fetch(`/api/campaigns/${campaign.id}/recipients`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactIds }),
          });
          if (review.campaign.activateNow) {
            await fetch(`/api/campaigns/${campaign.id}/start`, { method: "POST" });
          }
        }
        links.push({ label: "View campaign", href: `/campaigns/${campaign.id}` });
      }

      if (kept.has("sequence") && review.sequence) {
        const createRes = await fetch("/api/sequences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: review.sequence.name }),
        });
        const { sequence } = await createRes.json();
        for (const step of review.sequence.steps) {
          await fetch(`/api/sequences/${sequence.id}/steps`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delaySeconds: step.delaySeconds, subject: step.subject, body: step.bodyHtml, bodyFormat: "RICH_TEXT" }),
          });
        }
        if (contactIds && contactIds.length > 0) {
          await fetch(`/api/sequences/${sequence.id}/enrollments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactIds }),
          });
        }
        if (review.sequence.activateNow) {
          await fetch(`/api/sequences/${sequence.id}/activate`, { method: "POST" });
        }
        links.push({ label: "View sequence", href: `/sequences/${sequence.id}` });
      }

      if (kept.has("newsletter") && review.newsletter) {
        const templateRes = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `AI Newsletter Template — ${new Date().toLocaleDateString()}`,
            subject: review.newsletter.subject,
            body: review.newsletter.bodyHtml,
            bodyFormat: "RICH_TEXT",
          }),
        });
        const { template } = await templateRes.json();
        const start = new Date(answers.common.startAt);
        await fetch("/api/newsletters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `AI Newsletter — ${new Date().toLocaleDateString()}`,
            templateId: template.id,
            targetTagId: answers.common.tagId,
            frequency: review.newsletter.frequency,
            dayOfWeek: review.newsletter.frequency === "WEEKLY" ? start.getUTCDay() : undefined,
            dayOfMonth: review.newsletter.frequency === "MONTHLY" ? start.getUTCDate() : undefined,
            hourUtc: 9,
            minuteUtc: 0,
          }),
        });
        links.push({ label: "View newsletters", href: "/newsletters" });
      }

      if (kept.has("social") && review.socialPosts && review.socialPosts.length > 0) {
        const startMs = new Date(answers.common.startAt).getTime();
        const durationMs = answers.common.durationDays * 86400000;
        const n = review.socialPosts.length;
        for (let i = 0; i < review.socialPosts.length; i++) {
          const p = review.socialPosts[i];
          const createRes = await fetch("/api/social/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ socialAccountId: p.accountId, caption: p.caption, mediaImageId: p.mediaImageId }),
          });
          const { post } = await createRes.json();
          if (scheduleSocialNow && p.mediaImageId) {
            const scheduledAt = new Date(startMs + (durationMs * i) / Math.max(1, n));
            await fetch(`/api/social/posts/${post.id}/schedule`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
            });
          }
        }
        links.push({ label: "View posts", href: "/social" });
      }

      if (kept.has("template") && review.template) {
        await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: review.template.name,
            subject: review.template.subject,
            body: review.template.bodyHtml,
            bodyFormat: "RICH_TEXT",
          }),
        });
        links.push({ label: "View templates", href: "/templates" });
      }

      toast.success("Campaign created");
      onDone(links);
    } catch {
      toast.error("Something went wrong creating your campaign — check what was created so far.");
    } finally {
      setCreating(false);
    }
  }

  if (tabs.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing left to create — every piece was skipped.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue={tabs[0]}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.includes("campaign") && review.campaign && (
          <TabsContent value="campaign">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => skip("campaign")}>
                    Skip this one
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Subject</Label>
                  <Input
                    value={review.campaign.subject}
                    onChange={(e) => setReview((r) => ({ ...r, campaign: { ...r.campaign!, subject: e.target.value } }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Body</Label>
                  <EmailBodyEditor
                    bodyFormat="RICH_TEXT"
                    onBodyFormatChange={() => {}}
                    content={review.campaign.bodyHtml}
                    onChange={(html) => setReview((r) => ({ ...r, campaign: { ...r.campaign!, bodyHtml: html } }))}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={review.campaign.activateNow}
                    onCheckedChange={(v) => setReview((r) => ({ ...r, campaign: { ...r.campaign!, activateNow: v } }))}
                  />
                  <Label>Start sending immediately after creating</Label>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {tabs.includes("sequence") && review.sequence && (
          <TabsContent value="sequence">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => skip("sequence")}>
                    Skip this one
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Sequence name</Label>
                  <Input
                    value={review.sequence.name}
                    onChange={(e) => setReview((r) => ({ ...r, sequence: { ...r.sequence!, name: e.target.value } }))}
                  />
                </div>
                {review.sequence.steps.map((step, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Step {i + 1} — {i === 0 ? "sent immediately" : `${step.delaySeconds / 86400} days after the previous step`}
                    </p>
                    <Input
                      value={step.subject}
                      onChange={(e) =>
                        setReview((r) => {
                          const steps = [...r.sequence!.steps];
                          steps[i] = { ...steps[i], subject: e.target.value };
                          return { ...r, sequence: { ...r.sequence!, steps } };
                        })
                      }
                    />
                    <EmailBodyEditor
                      bodyFormat="RICH_TEXT"
                      onBodyFormatChange={() => {}}
                      content={step.bodyHtml}
                      onChange={(html) =>
                        setReview((r) => {
                          const steps = [...r.sequence!.steps];
                          steps[i] = { ...steps[i], bodyHtml: html };
                          return { ...r, sequence: { ...r.sequence!, steps } };
                        })
                      }
                    />
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={review.sequence.activateNow}
                    onCheckedChange={(v) => setReview((r) => ({ ...r, sequence: { ...r.sequence!, activateNow: v } }))}
                  />
                  <Label>Activate immediately after creating</Label>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {tabs.includes("newsletter") && review.newsletter && (
          <TabsContent value="newsletter">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => skip("newsletter")}>
                    Skip this one
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Subject</Label>
                  <Input
                    value={review.newsletter.subject}
                    onChange={(e) => setReview((r) => ({ ...r, newsletter: { ...r.newsletter!, subject: e.target.value } }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Body</Label>
                  <EmailBodyEditor
                    bodyFormat="RICH_TEXT"
                    onBodyFormatChange={() => {}}
                    content={review.newsletter.bodyHtml}
                    onChange={(html) => setReview((r) => ({ ...r, newsletter: { ...r.newsletter!, bodyHtml: html } }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Created as a draft newsletter — activate it from the Newsletters page when you&apos;re ready.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {tabs.includes("social") && review.socialPosts && (
          <TabsContent value="social">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => skip("social")}>
                    Skip this one
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {review.socialPosts.map((post, i) => (
                    <SocialPostCard
                      key={i}
                      post={post}
                      onChange={(patch) =>
                        setReview((r) => {
                          const posts = [...r.socialPosts!];
                          posts[i] = { ...posts[i], ...patch };
                          return { ...r, socialPosts: posts };
                        })
                      }
                      onRemove={() =>
                        setReview((r) => ({ ...r, socialPosts: r.socialPosts!.filter((_, idx) => idx !== i) }))
                      }
                    />
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={scheduleSocialNow} onCheckedChange={setScheduleSocialNow} />
                  <Label>Schedule these posts now (spread evenly across the campaign duration)</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only posts with an image attached can be scheduled — Instagram requires one; posts left without an image are created as drafts.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {tabs.includes("template") && review.template && (
          <TabsContent value="template">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => skip("template")}>
                    Skip this one
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Template name</Label>
                  <Input
                    value={review.template.name}
                    onChange={(e) => setReview((r) => ({ ...r, template: { ...r.template!, name: e.target.value } }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Subject</Label>
                  <Input
                    value={review.template.subject}
                    onChange={(e) => setReview((r) => ({ ...r, template: { ...r.template!, subject: e.target.value } }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Body</Label>
                  <EmailBodyEditor
                    bodyFormat="RICH_TEXT"
                    onBodyFormatChange={() => {}}
                    content={review.template.bodyHtml}
                    onChange={(html) => setReview((r) => ({ ...r, template: { ...r.template!, bodyHtml: html } }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Saved to your Template Library — reusable in any future campaign, sequence step, or newsletter.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Button onClick={approveAndCreate} disabled={creating} className="self-start">
        {creating ? "Creating…" : "Approve & Create"}
      </Button>
    </div>
  );
}
