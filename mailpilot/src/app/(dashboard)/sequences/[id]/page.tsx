import { SequenceBuilder } from "@/components/sequences/sequence-builder";

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SequenceBuilder sequenceId={id} />;
}
