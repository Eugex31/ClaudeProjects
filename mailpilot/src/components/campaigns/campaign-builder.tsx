"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmailBodyEditor, type EmailBodyEditorHandle, type BodyFormat } from "@/components/campaigns/email-body-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { MergeVarPicker } from "@/components/campaigns/merge-var-picker";
import { AiGeneratePanel } from "@/components/ai/ai-generate-panel";
import { RecipientsPanel } from "@/components/campaigns/recipients-panel";
import { PreviewPane } from "@/components/campaigns/preview-pane";
import { TestSendDialog } from "@/components/campaigns/test-send-dialog";
import { CampaignActions } from "@/components/campaigns/campaign-actions";
import { CampaignProgress } from "@/components/campaigns/campaign-progress";
import { SaveAsTemplateDialog } from "@/components/campaigns/template-controls";
import { BrowseTemplatesModal } from "@/components/templates/browse-templates-modal";
import { campaignUpdateSchema } from "@/lib/validation/campaign.schema";

type FormValues = z.input<typeof campaignUpdateSchema>;

type CampaignData = {
  id: string;
  name: string;
  subject: string;
  body: string;
  bodyFormat: BodyFormat;
  status: string;
  delayMinSeconds: number;
  delayMaxSeconds: number;
  dailySendLimitOverride: number | null;
  senderNameOverride: string | null;
  replyToOverride: string | null;
  unsubscribeFooterEnabled: boolean;
  _count: { recipients: number };
};

export function CampaignBuilder({ campaignId, userEmail }: { campaignId: string; userEmail: string }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [recipientCount, setRecipientCount] = useState(0);
  // Set only when the loaded content came from one of the user's OWN saved
  // templates (BrowseTemplatesModal only passes an id for the "My
  // Templates" tab — a starter/shared template never sets this, since
  // there's no owned row to write back to). Lets "Save changes to template"
  // push the campaign's current subject/body back into that same template
  // row, instead of only ever creating a new one via "Save as template".
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyEditorRef = useRef<EmailBodyEditorHandle>(null);
  const lastFocused = useRef<"subject" | "body">("body");

  const { register, handleSubmit, reset, setValue, getValues, control } = useForm<FormValues>({
    resolver: zodResolver(campaignUpdateSchema),
  });

  const bodyFormat: BodyFormat = useWatch({ control, name: "bodyFormat" }) ?? "RICH_TEXT";

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/campaigns/${campaignId}`);
    if (res.ok) {
      const { campaign: c } = await res.json();
      setCampaign(c);
      setRecipientCount(c._count.recipients);
      // A fresh load has no known source template — Browse Templates is the
      // only thing that (re-)establishes the link, each time it's used.
      setSourceTemplateId(null);
      reset({
        name: c.name,
        subject: c.subject,
        body: c.body,
        bodyFormat: c.bodyFormat,
        delayMinSeconds: c.delayMinSeconds,
        delayMaxSeconds: c.delayMaxSeconds,
        dailySendLimitOverride: c.dailySendLimitOverride ?? undefined,
        senderNameOverride: c.senderNameOverride ?? undefined,
        replyToOverride: c.replyToOverride ?? undefined,
        unsubscribeFooterEnabled: c.unsubscribeFooterEnabled,
      });
    }
    setLoading(false);
  }, [campaignId, reset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const locked = campaign?.status === "SENDING";

  async function onSubmit(values: FormValues) {
    setSaving(true);
    // While SENDING, every field but name is disabled and shouldn't be sent —
    // the API enforces this too, but scoping the payload here keeps a rename
    // an explicit, minimal PATCH rather than relying only on the backend
    // to ignore/reject the rest.
    const payload = locked ? { name: values.name } : values;
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save campaign");
      return;
    }
    toast.success("Campaign saved");
    setPreviewVersion((v) => v + 1);
    load();
  }

  function loadTemplate(template: { subject: string; body: string; bodyFormat: BodyFormat; id?: string }) {
    setSourceTemplateId(template.id ?? null);
    setValue("subject", template.subject, { shouldDirty: true });
    const formatChanging = template.bodyFormat !== bodyFormat;
    setValue("bodyFormat", template.bodyFormat, { shouldDirty: true });
    setValue("body", template.body, { shouldDirty: true });
    // Only push content imperatively when the format ISN'T changing — the
    // editor stays mounted, so it needs the push. When the format IS
    // changing, EmailBodyEditor swaps to a different child editor on the
    // next render, which already picks up the new body via its own content
    // prop; calling setContent here too would hit the OLD (about-to-unmount,
    // wrong-format) editor for one synchronous tick — e.g. feeding a full
    // HTML document into the rich-text editor's parser — and that stale
    // editor's own onChange would overwrite the correct body just set above.
    if (!formatChanging) {
      bodyEditorRef.current?.setContent(template.body);
    }
    toast.success("Template loaded — remember to save");
  }

  async function saveTemplateChanges() {
    if (!sourceTemplateId) return;
    setSavingTemplate(true);
    const res = await fetch(`/api/templates/${sourceTemplateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: getValues("subject"),
        body: getValues("body"),
        bodyFormat: getValues("bodyFormat"),
      }),
    });
    setSavingTemplate(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save template");
      return;
    }
    toast.success("Template updated");
  }

  function insertMergeVar(token: string) {
    if (lastFocused.current === "body") {
      bodyEditorRef.current?.insertMergeVar(token);
      return;
    }
    const ref = subjectRef.current;
    const current = getValues("subject") ?? "";
    if (ref) {
      const start = ref.selectionStart ?? current.length;
      const end = ref.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setValue("subject", next, { shouldDirty: true });
      requestAnimationFrame(() => {
        ref.focus();
        ref.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      setValue("subject", current + token, { shouldDirty: true });
    }
  }

  if (loading || !campaign) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const subjectField = register("subject");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="flex items-center gap-2">
          <TestSendDialog campaignId={campaignId} defaultEmail={userEmail} />
          <CampaignActions
            campaignId={campaignId}
            status={campaign.status}
            recipientCount={recipientCount}
            onChanged={load}
          />
        </div>
      </div>

      {campaign.status !== "DRAFT" && (
        <CampaignProgress campaignId={campaignId} active={campaign.status === "SENDING"} />
      )}

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="recipients">Recipients ({recipientCount})</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex flex-col gap-4">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {!locked && (
              <div className="flex items-center gap-2 self-end">
                {sourceTemplateId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={savingTemplate}
                    onClick={saveTemplateChanges}
                  >
                    Save changes to template
                  </Button>
                )}
                <BrowseTemplatesModal onSelect={loadTemplate} />
                <SaveAsTemplateDialog campaignId={campaignId} />
              </div>
            )}

            <div className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Campaign name</Label>
                <Input id="name" {...register("name")} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  disabled={locked}
                  {...subjectField}
                  ref={(el) => {
                    subjectField.ref(el);
                    subjectRef.current = el;
                  }}
                  onFocus={() => (lastFocused.current = "subject")}
                />
              </div>

              {!locked && (
                <AiGeneratePanel
                  kind="campaign"
                  existingSubject={getValues("subject")}
                  existingBody={getValues("body")}
                  onGenerated={(result) => loadTemplate({ subject: result.subject, body: result.bodyHtml, bodyFormat: "RICH_TEXT" })}
                />
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>Body</Label>
                  <MergeVarPicker onInsert={insertMergeVar} />
                </div>
                <EmailBodyEditor
                  ref={bodyEditorRef}
                  bodyFormat={bodyFormat}
                  onBodyFormatChange={(next) => setValue("bodyFormat", next, { shouldDirty: true })}
                  content={getValues("body") ?? campaign.body}
                  disabled={locked}
                  onChange={(html) => setValue("body", html, { shouldDirty: true })}
                  onFocus={() => (lastFocused.current = "body")}
                />
                <p className="text-xs text-muted-foreground">
                  Use {"{{first_name}}"}, {"{{company}}"}, {"{{greet}}"}, etc. for personalization.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-lg border border-dashed p-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Sending settings</p>
                <p className="text-xs text-muted-foreground">
                  Optional — leave blank to use your account defaults.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delayMinSeconds">Min delay (s)</Label>
                  <Input id="delayMinSeconds" type="number" disabled={locked} {...register("delayMinSeconds")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="delayMaxSeconds">Max delay (s)</Label>
                  <Input id="delayMaxSeconds" type="number" disabled={locked} {...register("delayMaxSeconds")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dailySendLimitOverride">Daily limit override</Label>
                  <Input
                    id="dailySendLimitOverride"
                    type="number"
                    placeholder="Use account default"
                    disabled={locked}
                    {...register("dailySendLimitOverride")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="senderNameOverride">Sender name</Label>
                  <Input
                    id="senderNameOverride"
                    placeholder="Use account default"
                    disabled={locked}
                    {...register("senderNameOverride")}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 sm:max-w-xs">
                <Label htmlFor="replyToOverride">Reply-to override</Label>
                <Input
                  id="replyToOverride"
                  type="email"
                  placeholder="Use account default"
                  disabled={locked}
                  {...register("replyToOverride")}
                />
              </div>

              <div className="flex items-center gap-3">
                <Controller
                  name="unsubscribeFooterEnabled"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      id="unsubscribeFooterEnabled"
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                      disabled={locked}
                    />
                  )}
                />
                <Label htmlFor="unsubscribeFooterEnabled">Include unsubscribe footer</Label>
              </div>
            </div>

            <div>
              <Button type="submit" disabled={saving}>
                Save changes
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="recipients">
          <RecipientsPanel campaignId={campaignId} locked={locked} onTotalChange={setRecipientCount} />
        </TabsContent>

        <TabsContent value="preview">
          <PreviewPane campaignId={campaignId} version={previewVersion} />
        </TabsContent>
      </Tabs>

      <div>
        <Button variant="ghost" onClick={() => router.push("/campaigns")}>
          Back to campaigns
        </Button>
      </div>
    </div>
  );
}
