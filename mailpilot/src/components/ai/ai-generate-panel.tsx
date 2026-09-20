"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Connection = { id: string; provider: "OPENAI" | "ANTHROPIC"; label: string; isDefault: boolean };
type Kind = "campaign" | "template" | "sequence-step" | "newsletter";

type Props = {
  kind: Kind;
  existingSubject?: string;
  existingBody?: string;
  onGenerated: (result: { subject: string; bodyHtml: string }) => void;
};

// Mounted above the existing body editor in campaign-builder.tsx,
// template-form-dialog.tsx, step-form-dialog.tsx, and the newsletter form —
// the third+ caller of the same setContent/reset editor-population pattern
// already used for "load template," so onGenerated just hands the result
// back for the parent to apply the same way it applies a loaded template.
export function AiGeneratePanel({ kind, existingSubject, existingBody, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionId, setConnectionId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || connections !== null) return;
    fetch("/api/ai/connections")
      .then((r) => r.json())
      .then((data: { connections: Connection[] }) => {
        setConnections(data.connections);
        const def = data.connections.find((c) => c.isDefault) ?? data.connections[0];
        if (def) setConnectionId(def.id);
      })
      .catch(() => setConnections([]));
  }, [open, connections]);

  async function generate() {
    if (!prompt.trim()) {
      toast.error("Describe what you want the AI to write first");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/ai/generate/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, kind, existingSubject, existingBody, connectionId: connectionId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Generation failed");
      return;
    }
    onGenerated(data);
    toast.success("Content generated — review before saving or sending");
  }

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-[#DDA974]" />
          Generate with AI
        </span>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t p-3">
          {connections === null ? (
            <p className="text-sm text-muted-foreground">Loading your AI connections&hellip;</p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No AI provider connected yet.{" "}
              <a href="/ai-connections" className="underline">
                Connect one
              </a>{" "}
              to generate content from a prompt.
            </p>
          ) : (
            <>
              {connections.length > 1 && (
                <Select value={connectionId} onValueChange={setConnectionId}>
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  existingBody
                    ? "Describe how to revise this draft (e.g. \"make it more urgent and add a discount\")"
                    : "Describe the email you want (e.g. \"a friendly follow-up for leads who requested a demo\")"
                }
                rows={3}
              />
              <Button onClick={generate} disabled={busy} className="self-start">
                {busy ? "Generating…" : "Generate"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
