"use client";
import { switchOrg } from "./actions";
import type { OrgSummary } from "@/lib/data/orgs";

export function OrgSwitcher({ orgs, currentId }: { orgs: OrgSummary[]; currentId: string }) {
  return (
    <select aria-label="Workspace" className="rounded border p-1" defaultValue={currentId}
      onChange={(e) => switchOrg(e.target.value)}>
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
