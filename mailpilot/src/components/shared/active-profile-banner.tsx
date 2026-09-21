"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shown whenever the active_profile_id cookie (src/lib/activeProfile.ts) is
// set — every page in this layout is now operating on that managed client's
// own data, not the agency's. Deliberately loud (not dismissible) since
// sending or editing the wrong tenant's data by mistake is a real risk this
// banner exists specifically to prevent.
export function ActiveProfileBanner({ label }: { label: string }) {
  const [exiting, setExiting] = useState(false);

  async function exit() {
    setExiting(true);
    await fetch("/api/profiles/exit", { method: "POST" });
    window.location.href = "/dashboard";
  }

  return (
    <div className="flex items-center gap-3 border-b bg-accent px-4 py-2.5 text-sm text-accent-foreground">
      <Users className="size-4 shrink-0" />
      <p className="flex-1">
        Acting as <strong>{label}</strong> — everything you do here belongs to this client, not your own account.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={exit} disabled={exiting}>
        Exit
      </Button>
    </div>
  );
}
