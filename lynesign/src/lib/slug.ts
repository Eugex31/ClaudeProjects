import { prisma } from "@/lib/db/root";

/**
 * Normalises arbitrary text into a URL-safe organization slug: lowercase, ASCII
 * alphanumerics separated by single hyphens, trimmed to 40 characters. Falls
 * back to "org" when the input has no usable characters.
 */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

/**
 * Returns a slug derived from `base` that is not already taken by an
 * organization. Tries the bare slug first, then `-2`, `-3`, ... up to 50
 * attempts, and finally a timestamp suffix as a last resort.
 */
export async function uniqueOrgSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await prisma.organization.findUnique({ where: { slug: candidate } }))) {
      return candidate;
    }
  }
  return `${root}-${Date.now()}`;
}
