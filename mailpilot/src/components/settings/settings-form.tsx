"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasLogo, setHasLogo] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [connectedGmailAddress, setConnectedGmailAddress] = useState<string | null>(null);
  const [isActingAsProfile, setIsActingAsProfile] = useState(false);

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
          socialFacebookUrl: settings.socialFacebookUrl ?? "",
          socialInstagramUrl: settings.socialInstagramUrl ?? "",
          socialLinkedinUrl: settings.socialLinkedinUrl ?? "",
          socialYoutubeUrl: settings.socialYoutubeUrl ?? "",
          socialXUrl: settings.socialXUrl ?? "",
          ctaDefaultLabel: settings.ctaDefaultLabel ?? "",
          ctaDefaultUrl: settings.ctaDefaultUrl ?? "",
        });
        setHasLogo(!!settings.hasSignatureLogo);
        setConnectedGmailAddress(settings.connectedGmailAddress ?? null);
        setIsActingAsProfile(!!settings.activeProfile);
        setLoading(false);
      });
  }, [reset]);

  // Feedback for the profile-Gmail hand-rolled OAuth redirect
  // (src/app/api/profile-gmail/callback) — mirrors how the Meta/Monday
  // connect flows surface their own redirect outcomes.
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "connect_failed") toast.error("Failed to connect Gmail. Try again.");
    if (error === "invalid_state") toast.error("Connection request expired. Try again.");
    if (error === "email_in_use") toast.error("That Gmail account is already connected to a different account.");
    if (searchParams.get("connected") === "1") toast.success("Gmail connected");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            {/* Real accounts link Google only when its email matches your login
                email (see auth.ts's allowDangerousEmailAccountLinking) — signing
                in with a different Google account here signs you into that other
                account instead of connecting it to this one. While acting as a
                managed client profile, there's no session to sign into at all, so
                this routes through a separate hand-rolled OAuth flow instead
                (src/app/api/profile-gmail/connect) that just links the account to
                the active profile without touching your own login. */}
            {connectedGmailAddress ? (
              <div className="flex items-center gap-3">
                <p className="text-sm">{connectedGmailAddress}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    isActingAsProfile
                      ? (window.location.href = "/api/profile-gmail/connect")
                      : signIn("google", { callbackUrl: "/settings" })
                  }
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
                  onClick={() =>
                    isActingAsProfile
                      ? (window.location.href = "/api/profile-gmail/connect")
                      : signIn("google", { callbackUrl: "/settings" })
                  }
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
          <CardTitle>Social links &amp; CTA</CardTitle>
          <CardDescription>
            Used by the &quot;Insert social icons&quot; and &quot;Insert CTA button&quot; actions in the email
            editor (HTML-format bodies only). Leave any blank to skip it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="socialFacebookUrl">Facebook page URL</Label>
              <Input id="socialFacebookUrl" placeholder="https://facebook.com/yourpage" {...register("socialFacebookUrl")} />
              {errors.socialFacebookUrl && <p className="text-sm text-destructive">{errors.socialFacebookUrl.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="socialInstagramUrl">Instagram page URL</Label>
              <Input id="socialInstagramUrl" placeholder="https://instagram.com/yourpage" {...register("socialInstagramUrl")} />
              {errors.socialInstagramUrl && <p className="text-sm text-destructive">{errors.socialInstagramUrl.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="socialLinkedinUrl">LinkedIn page URL</Label>
              <Input id="socialLinkedinUrl" placeholder="https://linkedin.com/company/yourpage" {...register("socialLinkedinUrl")} />
              {errors.socialLinkedinUrl && <p className="text-sm text-destructive">{errors.socialLinkedinUrl.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="socialYoutubeUrl">YouTube channel URL</Label>
              <Input id="socialYoutubeUrl" placeholder="https://youtube.com/@yourchannel" {...register("socialYoutubeUrl")} />
              {errors.socialYoutubeUrl && <p className="text-sm text-destructive">{errors.socialYoutubeUrl.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="socialXUrl">X (Twitter) URL</Label>
              <Input id="socialXUrl" placeholder="https://x.com/yourhandle" {...register("socialXUrl")} />
              {errors.socialXUrl && <p className="text-sm text-destructive">{errors.socialXUrl.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ctaDefaultLabel">Default CTA button text</Label>
              <Input id="ctaDefaultLabel" placeholder="Shop Now" {...register("ctaDefaultLabel")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ctaDefaultUrl">Default CTA link</Label>
              <Input id="ctaDefaultUrl" placeholder="https://yoursite.com" {...register("ctaDefaultUrl")} />
              {errors.ctaDefaultUrl && <p className="text-sm text-destructive">{errors.ctaDefaultUrl.message}</p>}
            </div>
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
