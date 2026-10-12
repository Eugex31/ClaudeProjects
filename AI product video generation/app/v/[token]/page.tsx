import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSharedProject } from "@/lib/data/share";
import { PublicPlayer } from "./PublicPlayer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharedVideoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await loadSharedProject(token);
  if (!shared) notFound();
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="mb-3 text-xl font-semibold">{shared.name} — assembly guide</h1>
      <PublicPlayer modelUrl={shared.modelUrl} steps={shared.steps} manifest={shared.parts} language={shared.language} />
      <p className="mt-4 text-xs text-gray-500">Made with StepReel</p>
    </main>
  );
}
