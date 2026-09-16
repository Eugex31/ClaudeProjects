"use client";

import * as React from "react";

import { formatBytes } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { MediaCardAsset } from "@/components/app/media/media-card";

export interface MediaPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: MediaCardAsset;
}

interface UrlResponse {
  url?: string;
  thumbnailUrl?: string | null;
}

/**
 * Controlled preview. When it opens it makes one request to
 * `/api/media/[id]/url` for a short-lived URL, then renders the asset by kind:
 * an `<img>`, a `<video controls>`, or a sandboxed `<iframe>` for web content.
 * A metadata list sits below the media.
 */
export function MediaPreviewDialog({ open, onOpenChange, asset }: MediaPreviewDialogProps) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setUrl(null);
      try {
        const res = await fetch(`/api/media/${asset.id}/url`);
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as UrlResponse;
        if (cancelled) return;
        if (!data.url) throw new Error("unavailable");
        setUrl(data.url);
      } catch {
        if (!cancelled) setError("This item could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, asset.id]);

  const meta: Array<[string, string]> = [["Kind", KIND_LABEL[asset.kind]]];
  if (asset.kind !== "WEB") meta.push(["Size", formatBytes(BigInt(asset.sizeBytes))]);
  if (asset.width && asset.height) meta.push(["Dimensions", `${asset.width} by ${asset.height}`]);
  if (asset.durationSeconds) meta.push(["Duration", `${asset.durationSeconds}s`]);
  if (asset.mimeType) meta.push(["Type", asset.mimeType]);
  if (asset.kind === "WEB" && asset.url) meta.push(["URL", asset.url]);
  if (asset.tags.length > 0) meta.push(["Tags", asset.tags.join(", ")]);
  meta.push(["Added", asset.createdAtLabel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{asset.name}</DialogTitle>
          <DialogDescription>{KIND_LABEL[asset.kind]} preview</DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border border-hairline bg-muted">
          {loading ? (
            <Skeleton className="aspect-video w-full" />
          ) : error ? (
            <p className="p-6 text-center text-sm text-body">{error}</p>
          ) : url && asset.kind === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={asset.name} className="max-h-[60vh] w-full object-contain" />
          ) : url && asset.kind === "VIDEO" ? (
            <video src={url} controls className="max-h-[60vh] w-full bg-black" />
          ) : url && asset.kind === "WEB" ? (
            <iframe
              src={url}
              title={asset.name}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="aspect-video w-full"
            />
          ) : null}
        </div>

        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
          {meta.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate text-body">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

const KIND_LABEL: Record<MediaCardAsset["kind"], string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  WEB: "Web",
};
