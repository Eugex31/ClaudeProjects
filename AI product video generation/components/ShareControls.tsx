"use client";
import { useState, useSyncExternalStore } from "react";
import { createShareLink, revokeShareLink } from "@/app/app/projects/[id]/shareActions";

const subscribe = () => () => {};

export function ShareControls({ projectId, initialToken, approved, editable }: {
  projectId: string; initialToken: string | null; approved: boolean; editable: boolean;
}) {
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState<string | null>(null);
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (!editable) return null;
  const url = token ? `${origin}/v/${token}` : null;
  return (
    <span className="flex items-center gap-2 text-sm">
      {url ? (
        <>
          <input readOnly value={url} className="w-64 rounded border px-1 text-xs" onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard.writeText(url)} className="underline">Copy</button>
          <button
            onClick={async () => {
              try { await revokeShareLink(projectId); setToken(null); setError(null); } catch (e) { setError((e as Error).message); }
            }}
            className="text-red-700 underline"
          >Revoke</button>
          {!approved && <span className="text-amber-700">Link is paused until the project is approved again.</span>}
        </>
      ) : (
        <button disabled={!approved} onClick={async () => {
          try { setToken(await createShareLink(projectId)); setError(null); } catch (e) { setError((e as Error).message); }
        }} className="rounded border px-3 py-1 disabled:opacity-40">Share link</button>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}
