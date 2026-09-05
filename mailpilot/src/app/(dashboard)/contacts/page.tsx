"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";

export default function ContactsPage() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground">Manage the people you send campaigns to.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/contacts/import">
              <Upload className="mr-2 size-4" />
              Import CSV
            </Link>
          </Button>
          <ContactFormDialog onSaved={() => setRefreshSignal((n) => n + 1)} />
        </div>
      </div>
      <ContactsTable refreshSignal={refreshSignal} />
    </div>
  );
}
