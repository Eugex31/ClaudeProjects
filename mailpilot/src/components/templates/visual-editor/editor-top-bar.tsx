"use client";

import { useRouter } from "next/navigation";
import { useEditor } from "@grapesjs/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// Single-purpose top bar per the reference: Close Editor (left), Save
// Template (right). No separate "Create Campaign" action — a saved
// template is turned into a campaign via the existing Browse Templates
// "Use" flow, so this button doesn't need to duplicate that.
export function EditorTopBar({
  templateId,
  saving,
  onSaving,
}: {
  templateId: string;
  saving: boolean;
  onSaving: (saving: boolean) => void;
}) {
  const editor = useEditor();
  const router = useRouter();

  async function handleSave() {
    onSaving(true);
    const editorSource = editor.getHtml();
    const res = await fetch(`/api/templates/${templateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editorSource }),
    });
    onSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save template");
      return;
    }
    toast.success("Template saved");
  }

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <Button type="button" variant="ghost" size="sm" onClick={() => router.push("/templates")}>
        Close Editor
      </Button>
      <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
        Save Template
      </Button>
    </div>
  );
}
