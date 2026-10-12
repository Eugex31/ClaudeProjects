"use client";
import { useState, useTransition } from "react";
import { switchOrg } from "./actions";
import type { OrgSummary } from "@/lib/data/orgs";

export function OrgSwitcher({ orgs, currentId }: { orgs: OrgSummary[]; currentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select aria-label="Workspace" className="rounded border p-1" defaultValue={currentId} disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          setError(null);
          start(async () => {
            try { await switchOrg(id); } catch (err) { setError(err instanceof Error ? err.message : "Could not switch workspace"); }
          });
        }}>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
    </>
  );
}
