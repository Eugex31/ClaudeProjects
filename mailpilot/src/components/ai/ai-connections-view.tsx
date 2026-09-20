"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type Provider = "OPENAI" | "ANTHROPIC";
type Connection = { id: string; provider: Provider; label: string; isDefault: boolean; createdAt: string };

const PROVIDER_LABEL: Record<Provider, string> = { OPENAI: "OpenAI", ANTHROPIC: "Anthropic" };

export function AiConnectionsView() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState<Provider>("OPENAI");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/ai/connections");
    if (res.ok) {
      const data = await res.json();
      setConnections(data.connections);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function addConnection() {
    if (!label.trim() || !apiKey.trim()) {
      toast.error("Label and API key are required");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/ai/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, label, apiKey }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to connect");
      return;
    }
    toast.success(`Connected ${PROVIDER_LABEL[provider]}`);
    setLabel("");
    setApiKey("");
    load();
  }

  async function setDefault(id: string) {
    setBusy(true);
    const res = await fetch(`/api/ai/connections/${id}/default`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to set default");
      return;
    }
    load();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/ai/connections/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to remove connection");
      return;
    }
    toast.success("Connection removed");
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Connect a provider</CardTitle>
          <CardDescription>Your key is encrypted at rest and never shown again after saving.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPENAI">OpenAI</SelectItem>
                  <SelectItem value="ANTHROPIC">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My OpenAI key" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>API key</Label>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-..." />
            </div>
          </div>
          <Button onClick={addConnection} disabled={busy} className="self-start">
            Connect
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your connections</CardTitle>
        </CardHeader>
        <CardContent>
          {connections === null ? (
            <Skeleton className="h-16 w-full" />
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI providers connected yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {connections.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{c.label}</span>
                    <Badge variant="outline">{PROVIDER_LABEL[c.provider]}</Badge>
                    {c.isDefault && <Badge>Default</Badge>}
                  </div>
                  <div className="flex gap-2">
                    {!c.isDefault && (
                      <Button variant="outline" size="sm" onClick={() => setDefault(c.id)} disabled={busy}>
                        Make default
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => remove(c.id)} disabled={busy}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
