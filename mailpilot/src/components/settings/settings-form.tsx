"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsUpdateSchema } from "@/lib/validation/settings.schema";

type FormValues = z.input<typeof settingsUpdateSchema>;

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg"];

export function SettingsForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasLogo, setHasLogo] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [connectedGmailAddress, setConnectedGmailAddress] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(settingsUpdateSchema) });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ settings }) => {
        reset({
          businessName: settings.businessName ?? "",
          dailySendLimit: settings.dailySendLimit,
          delayMinSeconds: settings.delayMinSeconds,
          delayMaxSeconds: settings.delayMaxSeconds,
          senderName: settings.senderName ?? "",
          replyTo: settings.replyTo ?? "",
          signatureHtml: settings.signatureHtml ?? "",
          unsubscribeFooterText: settings.unsubscribeFooterText ?? "",
        });
        setHasLogo(!!settings.hasSignatureLogo);
        setConnectedGmailAddress(settings.connectedGmailAddress ?? null);
        setLoading(false);
      });
  }, [reset]);

  async function onLogoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
      toast.error("Logo must be a PNG or JPG image");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo must be 2MB or smaller");
      return;
    }

    setLogoBusy(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/settings/signature-logo", { method: "POST", body: formData });
    setLogoBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to upload logo");
      return;
    }
    setHasLogo(true);
    setLogoVersion((v) => v + 1);
    toast.success("Signature logo updated");
  }

  async function removeLogo() {
    setLogoBusy(true);
    const res = await fetch("/api/settings/signature-logo", { method: "DELETE" });
    setLogoBusy(false);

    if (!res.ok) {
      toast.error("Failed to remove logo");
      return;
    }
    setHasLogo(false);
    toast.success("Signature logo removed");
  }

  async function onSubmit(values: FormValues) {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save settings");
      return;
    }
    toast.success("Settings saved");
  }

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-2xl" />;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>Your account identity and where campaigns send from.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="businessName">Business name</Label>
            <Input id="businessName" placeholder="Acme Inc." {...register("businessName")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Sending email</Label>
            {/* Links to this account only when the Google account's email matches
                your login email (see auth.ts's allowDangerousEmailAccountLinking) —
                signing in with a different Google account here signs you into that
                other account instead of connecting it to this one. */}
            {connectedGmailAddress ? (
              <div className="flex items-center gap-3">
                <p className="text-sm">{connectedGmailAddress}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => signIn("google", { callbackUrl: "/settings" })}
                >
                  Reconnect
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">No Gmail account connected — campaigns can&apos;t send yet.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => signIn("google", { callbackUrl: "/settings" })}
                >
                  Connect Gmail
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sending limits</CardTitle>
          <CardDescription>
            Regular Gmail accounts are capped at roughly 500 sends/day by Google (Workspace accounts:
            ~2000/day). Keep your daily limit comfortably under that to avoid being flagged.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dailySendLimit">Daily send limit</Label>
            <Input id="dailySendLimit" type="number" {...register("dailySendLimit")} />
            {errors.dailySendLimit && (
              <p className="text-sm text-destructive">{errors.dailySendLimit.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delayMinSeconds">Min delay (s)</Label>
            <Input id="delayMinSeconds" type="number" {...register("delayMinSeconds")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delayMaxSeconds">Max delay (s)</Label>
            <Input id="delayMaxSeconds" type="number" {...register("delayMaxSeconds")} />
            {errors.delayMaxSeconds && (
              <p className="text-sm text-destructive">{errors.delayMaxSeconds.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sender defaults</CardTitle>
          <CardDescription>Used for every campaign unless overridden individually.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="senderName">Sender name</Label>
              <Input id="senderName" placeholder="Jane Doe" {...register("senderName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="replyTo">Reply-to address</Label>
              <Input id="replyTo" type="email" {...register("replyTo")} />
              {errors.replyTo && <p className="text-sm text-destructive">{errors.replyTo.message}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signatureHtml">Email signature</Label>
            <Textarea id="signatureHtml" rows={4} {...register("signatureHtml")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signature logo</CardTitle>
          <CardDescription>
            Shown under your signature on every campaign. PNG or JPG, up to 2MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {hasLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/settings/signature-logo?v=${logoVersion}`}
              alt="Signature logo preview"
              className="max-h-16 w-auto"
              onError={() => setHasLogo(false)}
            />
          )}
          <div className="flex items-center gap-3">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              disabled={logoBusy}
              onChange={onLogoSelected}
              className="max-w-xs"
            />
            {hasLogo && (
              <Button type="button" variant="outline" disabled={logoBusy} onClick={removeLogo}>
                Remove logo
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance</CardTitle>
          <CardDescription>
            Appended to campaigns with the unsubscribe footer enabled. Complying with CAN-SPAM, GDPR, and
            similar regulations is your responsibility.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unsubscribeFooterText">Unsubscribe footer text</Label>
            <Textarea
              id="unsubscribeFooterText"
              rows={3}
              placeholder="If you'd rather not hear from us, just reply and let us know."
              {...register("unsubscribeFooterText")}
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={saving}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
