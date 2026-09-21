"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Share2, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BodyFormat } from "@/components/campaigns/email-body-editor";

type SocialSettings = {
  socialFacebookUrl: string | null;
  socialInstagramUrl: string | null;
  socialLinkedinUrl: string | null;
  socialYoutubeUrl: string | null;
  socialXUrl: string | null;
  ctaDefaultLabel: string | null;
  ctaDefaultUrl: string | null;
};

const PLATFORMS: { key: keyof SocialSettings; icon: string; label: string; badgeColor: string }[] = [
  { key: "socialFacebookUrl", icon: "facebook", label: "Facebook", badgeColor: "#1877F2" },
  { key: "socialInstagramUrl", icon: "instagram", label: "Instagram", badgeColor: "#E4405F" },
  { key: "socialLinkedinUrl", icon: "linkedin", label: "LinkedIn", badgeColor: "#0A66C2" },
  { key: "socialYoutubeUrl", icon: "youtube", label: "YouTube", badgeColor: "#FF0000" },
];

// X has no icon glyph among the reusable public/social/*.png assets, so it's
// included in Settings/link insertion but left out of the icon row — the
// social-icons block only ever inserts platforms it can actually render.

const NOT_HTML_TITLE = "Switch to HTML mode to use this";

export function InsertBlocksMenu({ bodyFormat, onInsert }: { bodyFormat: BodyFormat; onInsert: (html: string) => void }) {
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [ctaOpen, setCtaOpen] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ settings: s }) => {
        setSettings(s);
        setCtaLabel(s.ctaDefaultLabel ?? "");
        setCtaUrl(s.ctaDefaultUrl ?? "");
      })
      .catch(() => setSettings(null));
  }, []);

  const disabled = bodyFormat !== "HTML";

  function insertSocialIcons() {
    const configured = PLATFORMS.filter((p) => settings?.[p.key]);
    if (configured.length === 0) {
      toast.error("Add your social links in Settings first");
      return;
    }
    const baseUrl = window.location.origin;
    const cells = configured
      .map(
        (p) => `
                  <td style="padding:0 6px;">
                    <a href="${settings![p.key]}" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:${p.badgeColor};text-decoration:none;"><img src="${baseUrl}/social/${p.icon}.png" width="18" height="18" alt="${p.label}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>`
      )
      .join("");
    const html = `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto;">
            <tr>${cells}
            </tr>
          </table>`;
    onInsert(html);
  }

  function insertCta() {
    if (!ctaLabel.trim() || !ctaUrl.trim()) {
      toast.error("Enter both a label and a link");
      return;
    }
    const html = `<a href="${ctaUrl}" target="_blank" style="display:inline-block;background-color:#111827;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">${ctaLabel}</a>`;
    onInsert(html);
    setCtaOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        title={disabled ? NOT_HTML_TITLE : undefined}
        onClick={insertSocialIcons}
      >
        <Share2 className="mr-1.5 size-3.5" />
        Insert social icons
      </Button>

      <Popover open={ctaOpen} onOpenChange={setCtaOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled} title={disabled ? NOT_HTML_TITLE : undefined}>
            <MousePointerClick className="mr-1.5 size-3.5" />
            Insert CTA button
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cta-label">Button text</Label>
              <Input id="cta-label" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Shop Now" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cta-url">Link</Label>
              <Input id="cta-url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://yoursite.com" />
            </div>
            <Button type="button" size="sm" onClick={insertCta} className="self-start">
              Insert
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
