export const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PASTED_CHARS = 100_000;
const MAX_STORED_CHARS = 500_000;

export function normalizeManualText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_STORED_CHARS);
}

export function assetPath(orgId: string, projectId: string, assetId: string, filename: string): string {
  return `${orgId}/${projectId}/${assetId}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}
