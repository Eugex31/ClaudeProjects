import { SequencesTable } from "@/components/sequences/sequences-table";
import { NewSequenceDialog } from "@/components/sequences/new-sequence-dialog";

export default function SequencesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sequences</h1>
          <p className="text-muted-foreground">Multi-step, timed automation for onboarding, nurturing, and re-engagement.</p>
        </div>
        <NewSequenceDialog />
      </div>
      <SequencesTable />
    </div>
  );
}
