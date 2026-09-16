import { readFileSync } from "fs";
import { join } from "path";

// undefined = not loaded yet, null = file missing/unreadable (checked once
// per asset, then cached either way — these files only change on a
// redeploy, which restarts the process).
const bufferCache = new Map<string, Buffer | null>();

function loadAssetBuffer(relativePath: string): Buffer | null {
  if (bufferCache.has(relativePath)) return bufferCache.get(relativePath)!;
  let buffer: Buffer | null;
  try {
    buffer = readFileSync(join(process.cwd(), "public", relativePath));
  } catch {
    buffer = null;
  }
  bufferCache.set(relativePath, buffer);
  return buffer;
}

export type InlinedAssetAttachment = { cid: string; filename: string; contentType: string; content: Buffer };

// Every asset this app hosts itself that a campaign/template/sequence-step
// body might reference by absolute URL — the logo (prisma/seed.ts's
// LOGO_URL) plus the four social-icon glyphs (SOCIAL_ICON_URLS) used on the
// branded HTML starter templates' social row. One entry per real static file
// under public/.
const KNOWN_ASSETS: { cid: string; publicPath: string; filename: string; contentType: string }[] = [
  { cid: "app-logo", publicPath: "logo.png", filename: "logo.png", contentType: "image/png" },
  { cid: "social-facebook", publicPath: "social/facebook.png", filename: "facebook.png", contentType: "image/png" },
  { cid: "social-linkedin", publicPath: "social/linkedin.png", filename: "linkedin.png", contentType: "image/png" },
  { cid: "social-instagram", publicPath: "social/instagram.png", filename: "instagram.png", contentType: "image/png" },
  { cid: "social-youtube", publicPath: "social/youtube.png", filename: "youtube.png", contentType: "image/png" },
];

/**
 * Real sends can't rely on an absolute `${NEXTAUTH_URL}/...` <img src> for
 * the app's own hosted images the way in-browser preview can — a
 * recipient's mail client (or Gmail's own image-fetching proxy) resolves
 * that URL from ITS OWN network, which has no route to a developer's
 * `http://localhost:3000`, and even a real public NEXTAUTH_URL adds an
 * avoidable external fetch every open depends on. This rewrites any
 * reference to a known app-hosted asset (the logo, the social-icon glyphs)
 * to a `cid:` reference and returns the real file bytes to attach inline —
 * the exact mechanism already proven for the account's own signature logo
 * (`cid:signature-logo`), generalized here to every first-party image this
 * app embeds in outgoing HTML. Never rewrites a recipient's own image URLs
 * — only the fixed, known set of app-hosted paths above.
 */
export function inlineAppLogo(html: string): { html: string; attachments: InlinedAssetAttachment[] } {
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) return { html, attachments: [] };

  let rewritten = html;
  const attachments: InlinedAssetAttachment[] = [];

  for (const asset of KNOWN_ASSETS) {
    const assetUrl = `${baseUrl}/${asset.publicPath}`;
    if (!rewritten.includes(assetUrl)) continue;

    const buffer = loadAssetBuffer(asset.publicPath);
    if (!buffer) continue; // nothing to attach, leave src as-is rather than crash

    rewritten = rewritten.split(assetUrl).join(`cid:${asset.cid}`);
    attachments.push({ cid: asset.cid, filename: asset.filename, contentType: asset.contentType, content: buffer });
  }

  return { html: rewritten, attachments };
}
