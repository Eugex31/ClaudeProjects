import { Suspense } from "react";
import { AiConnectionsView } from "@/components/ai/ai-connections-view";

export default function AiConnectionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connect your own OpenAI or Anthropic API key to generate email and campaign content from a prompt.
          You&apos;re billed directly by the provider for usage &mdash; the app never sees or marks up the cost.
        </p>
      </div>
      <Suspense>
        <AiConnectionsView />
      </Suspense>
    </div>
  );
}
