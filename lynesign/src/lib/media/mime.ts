// Allowlist of supported MIME types for media uploads
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
]);

/**
 * Classify a MIME type into a media kind or null if unsupported.
 */
export function classifyKind(mimeType: string): "IMAGE" | "VIDEO" | null {
  if (IMAGE_MIMES.has(mimeType)) return "IMAGE";
  if (VIDEO_MIMES.has(mimeType)) return "VIDEO";
  return null;
}

/**
 * Map a MIME type to its file extension.
 */
export function extForMime(mimeType: string): string {
  const extMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return extMap[mimeType] || "";
}

/**
 * Derive a display name from a filename by stripping the extension.
 * Falls back to "Untitled" if the result is empty.
 */
export function deriveName(filename: string): string {
  if (!filename) return "Untitled";
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return filename.trim() || "Untitled";
  const name = filename.substring(0, lastDot).trim();
  return name || "Untitled";
}

/**
 * Maximum file size limits for media uploads.
 */
export const MEDIA_MAX_BYTES = {
  IMAGE: 25 * 1024 * 1024,  // 25 MiB
  VIDEO: 500 * 1024 * 1024, // 500 MiB
};
