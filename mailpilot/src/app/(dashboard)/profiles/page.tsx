import { Suspense } from "react";
import { ProfilesView } from "@/components/profiles/profiles-view";

export default function ProfilesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
        <p className="text-sm text-muted-foreground">
          Manage a client&apos;s campaigns, contacts, and sending on their behalf — each profile is its own separate
          workspace with its own connected Gmail.
        </p>
      </div>
      <Suspense>
        <ProfilesView />
      </Suspense>
    </div>
  );
}
