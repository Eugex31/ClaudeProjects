"use client";

import { useState } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TARGET_FIELDS = [
  { value: "ignore", label: "Ignore this column" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "company", label: "Company" },
  { value: "jobTitle", label: "Job title" },
  { value: "website", label: "Website" },
  { value: "greet", label: "Greet" },
  { value: "appointmentAt", label: "Appointment date" },
  { value: "custom", label: "Custom field..." },
] as const;

type Mapping = Record<string, { target: string; customName: string }>;

type ImportResult = { totalRows: number; imported: number; duplicatesSkipped: number; invalidSkipped: number };

export function ImportWizard() {
  const router = useRouter();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const fields = parsed.meta.fields ?? [];
        setHeaders(fields);
        setRows(parsed.data);
        const initialMapping: Mapping = {};
        for (const field of fields) {
          const guess = TARGET_FIELDS.find(
            (t) => t.value !== "ignore" && t.value !== "custom" && field.toLowerCase().replace(/[^a-z]/g, "").includes(t.value.toLowerCase())
          );
          initialMapping[field] = { target: guess?.value ?? "ignore", customName: "" };
        }
        setMapping(initialMapping);
        setResult(null);
      },
      error: () => toast.error("Failed to parse CSV file"),
    });
  }

  async function handleImport() {
    const emailField = Object.entries(mapping).find(([, m]) => m.target === "email")?.[0];
    if (!emailField) {
      toast.error("You must map a column to Email");
      return;
    }

    const contactRows = rows.map((row) => {
      const contact: Record<string, unknown> = {};
      const customFields: Record<string, string> = {};
      for (const [column, m] of Object.entries(mapping)) {
        const value = row[column]?.trim();
        if (!value || m.target === "ignore") continue;
        if (m.target === "custom") {
          if (m.customName.trim()) customFields[m.customName.trim()] = value;
        } else {
          contact[m.target] = value;
        }
      }
      if (Object.keys(customFields).length > 0) contact.customFields = customFields;
      return contact;
    });

    setSubmitting(true);
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: contactRows }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Import failed");
      return;
    }

    const data: ImportResult = await res.json();
    setResult(data);
    toast.success(`Imported ${data.imported} contacts`);
  }

  if (result) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Import complete</CardTitle>
          <CardDescription>{result.totalRows} rows processed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex justify-between text-sm">
            <span>Imported</span>
            <span className="font-medium">{result.imported}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Duplicates skipped</span>
            <span className="font-medium">{result.duplicatesSkipped}</span>
          </div>
          {result.invalidSkipped > 0 && (
            <div className="flex justify-between text-sm">
              <span>Invalid rows skipped (missing/bad email)</span>
              <span className="font-medium">{result.invalidSkipped}</span>
            </div>
          )}
          <Button onClick={() => router.push("/contacts")}>Go to contacts</Button>
        </CardContent>
      </Card>
    );
  }

  if (headers.length === 0) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Upload a CSV file</CardTitle>
          <CardDescription>The first row should contain column headers.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-10 text-muted-foreground hover:bg-accent">
            <UploadCloud className="size-8" />
            <span>Click to choose a file</span>
            <Input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Map columns</CardTitle>
          <CardDescription>Tell us which CSV column maps to which contact field.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {headers.map((header) => (
            <div key={header} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm font-medium">{header}</span>
              <Select
                value={mapping[header]?.target ?? "ignore"}
                onValueChange={(value) =>
                  setMapping((m) => ({ ...m, [header]: { target: value, customName: m[header]?.customName ?? "" } }))
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mapping[header]?.target === "custom" && (
                <div className="flex items-center gap-2">
                  <Label className="sr-only">Custom field name</Label>
                  <Input
                    placeholder="Field name"
                    className="w-40"
                    value={mapping[header]?.customName ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [header]: { target: "custom", customName: e.target.value } }))
                    }
                  />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>{rows.length} rows detected. Showing the first 5.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 5).map((row, i) => (
                <TableRow key={i}>
                  {headers.map((h) => (
                    <TableCell key={h}>{row[h]}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setHeaders([])}>
          Start over
        </Button>
        <Button onClick={handleImport} disabled={submitting}>
          Import {rows.length} contacts
        </Button>
      </div>
    </div>
  );
}
