"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

// Surfaces Gmail-connection status everywhere in the app, not just buried in
// Settings — today a customer can build an entire campaign and only find out
// they never connected Gmail when a send silently fails. Reads the same
// `connectedGmailAddress` field GET /api/settings already returns; no new
// endpoint. Dismissal is per browser tab/session only (a plain useState, no
// persistence) — it should reappear on the next real visit until resolved,
// since the underlying problem (can't send) hasn't gone away.
export function GmailConnectionBanner() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setConnected(!!data.settings?.connectedGmailAddress);
      })
      .catch(() => {
        if (!cancelled) setConnected(true); // fail open — don't nag on a network hiccup
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (connected !== false || dismissed) return null;

  return (
    <div className="flex items-center gap-3 border-b bg-accent px-4 py-2.5 text-sm text-accent-foreground">
      <Mail className="size-4 shrink-0" />
      <p className="flex-1">
        Connect Gmail to start sending campaigns.{" "}
        <Link href="/settings" className="font-medium underline underline-offset-2">
          Connect now
        </Link>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setDismissed(true)}
        title="Dismiss"
        className="text-accent-foreground hover:bg-accent-foreground/10"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
