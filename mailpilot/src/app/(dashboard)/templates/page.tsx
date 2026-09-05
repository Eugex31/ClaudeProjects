"use client";

import { useState } from "react";
import { TemplatesTable } from "@/components/templates/templates-table";
import { TemplateFormDialog, type TemplateRecord } from "@/components/templates/template-form-dialog";
import { BrowseTemplatesModal } from "@/components/templates/browse-templates-modal";

export default function TemplatesPage() {
  const [refreshSignal, setRefreshSignal] = useState(0);
  // A draft prefilled from Browse Templates — no `id`, so TemplateFormDialog
  // treats it as "create new" (POST) rather than "edit" (PATCH), same
  // distinction browse-templates-modal.tsx's own "Edit" action already
  // relies on for starter-template copies.
  const [draft, setDraft] = useState<TemplateRecord | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-muted-foreground">Reusable subject/body pairs you can load into any campaign.</p>
        </div>
        <div className="flex items-center gap-2">
          <BrowseTemplatesModal
            onSelect={(t) =>
              setDraft({ id: t.id, name: t.name ?? "", subject: t.subject, body: t.body, bodyFormat: t.bodyFormat })
            }
          />
          <TemplateFormDialog onSaved={() => setRefreshSignal((n) => n + 1)} />
        </div>
      </div>
      <TemplatesTable refreshSignal={refreshSignal} />

      {draft && (
        <TemplateFormDialog
          template={draft}
          open={Boolean(draft)}
          onOpenChange={(o) => !o && setDraft(null)}
          trigger={null}
          onSaved={() => {
            setDraft(null);
            setRefreshSignal((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
