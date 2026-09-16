"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Contact = { id: string; firstName: string | null; lastName: string | null; email: string };

export function PreviewPane({ campaignId, version }: { campaignId: string; version: number }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sampleId, setSampleId] = useState<string>("__fallback__");
  const [preview, setPreview] = useState<{ subject: string; html: string; bodyFormat?: "RICH_TEXT" | "HTML" } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/contacts?pageSize=50")
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/campaigns/${campaignId}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sampleContactId: sampleId === "__fallback__" ? undefined : sampleId }),
    })
      .then((r) => r.json())
      .then((d) => setPreview(d))
      .finally(() => setLoading(false));
  }, [campaignId, sampleId, version]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Preview as</span>
        <Select value={sampleId} onValueChange={setSampleId}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__fallback__">Fallback values (no contact)</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardHeader className="border-b font-medium">
          {loading || !preview ? <Skeleton className="h-5 w-2/3" /> : preview.subject || "(no subject)"}
        </CardHeader>
        <CardContent className="pt-4">
          {loading || !preview ? (
            <Skeleton className="h-32 w-full" />
          ) : preview.bodyFormat === "HTML" ? (
            // Full HTML documents (their own <style> block, table layout) need
            // real isolation from the host page — an iframe, not a div, so the
            // template's CSS can't leak into (or collide with) this app's own
            // styling. sandbox="allow-same-origin" only, no allow-scripts —
            // defense in depth on top of composeEmail's server-side sanitizer.
            <iframe
              srcDoc={preview.html || "<p>(no body)</p>"}
              sandbox="allow-same-origin"
              title="Email preview"
              className="h-[600px] w-full rounded-md border-0"
            />
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: preview.html || "<em>(no body)</em>" }} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
