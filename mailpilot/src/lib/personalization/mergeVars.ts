export type MergeContact = {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  website?: string | null;
  greet?: string | null;
  customFields?: unknown;
};

const DEFAULT_FALLBACKS: Record<string, string> = {
  first_name: "there",
  last_name: "",
  company: "your company",
  job_title: "",
  website: "",
  greet: "",
};

export const BUILT_IN_MERGE_VARS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "company", label: "Company" },
  { key: "job_title", label: "Job title" },
  { key: "website", label: "Website" },
  { key: "greet", label: "Greeting" },
] as const;

const MERGE_VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderMergeVars(template: string, contact: MergeContact): string {
  const builtIn: Record<string, string | null | undefined> = {
    first_name: contact.firstName,
    last_name: contact.lastName,
    company: contact.company,
    job_title: contact.jobTitle,
    website: contact.website,
    greet: contact.greet,
  };
  const customFields = (contact.customFields as Record<string, string> | null) ?? {};

  return template.replace(MERGE_VAR_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (key in builtIn) {
      return builtIn[key] || DEFAULT_FALLBACKS[key] || "";
    }
    if (customFields[rawKey]) return customFields[rawKey];
    if (customFields[key]) return customFields[key];
    return "";
  });
}

export function extractMergeVarKeys(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(MERGE_VAR_PATTERN)) {
    keys.add(match[1]);
  }
  return Array.from(keys);
}
