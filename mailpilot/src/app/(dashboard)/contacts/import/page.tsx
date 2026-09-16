import { ImportWizard } from "@/components/contacts/import-wizard";

export default function ImportContactsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import contacts</h1>
        <p className="text-muted-foreground">Upload a CSV and map its columns to contact fields.</p>
      </div>
      <ImportWizard />
    </div>
  );
}
