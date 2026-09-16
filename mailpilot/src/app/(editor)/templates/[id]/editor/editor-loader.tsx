"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// grapesjs-mjml's bundle touches `window` at module-evaluation time (not
// just when actually used), which crashes Next.js's SSR pass of this
// otherwise-ordinary 'use client' component — a plain 'use client' boundary
// isn't enough here. ssr: false skips server rendering for it entirely, so
// the module is only ever evaluated in the browser. `next/dynamic` with
// ssr: false is only valid inside a Client Component, hence this thin
// wrapper file rather than calling it directly from the (server) page.tsx.
const MjmlTemplateEditor = dynamic(
  () => import("@/components/templates/visual-editor/mjml-template-editor").then((m) => m.MjmlTemplateEditor),
  { ssr: false, loading: () => <Skeleton className="h-screen w-full" /> }
);

export function EditorLoader({ templateId }: { templateId: string }) {
  return <MjmlTemplateEditor templateId={templateId} />;
}
