"use client";

import { useState } from "react";
import { NewslettersTable } from "@/components/newsletters/newsletters-table";
import { NewsletterFormDialog } from "@/components/newsletters/newsletter-form-dialog";

export default function NewslettersPage() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Newsletters</h1>
          <p className="text-muted-foreground">Recurring sends built from a template, on a schedule.</p>
        </div>
        <NewsletterFormDialog onSaved={() => setRefreshSignal((n) => n + 1)} />
      </div>
      <NewslettersTable refreshSignal={refreshSignal} />
    </div>
  );
}
