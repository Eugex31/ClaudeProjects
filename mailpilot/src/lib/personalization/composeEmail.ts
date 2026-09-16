import sanitizeHtml from "sanitize-html";
import { renderMergeVars, type MergeContact } from "@/lib/personalization/mergeVars";
import { appendBeforeBodyClose } from "@/lib/personalization/htmlDocument";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Matches exactly what the campaign body's rich text editor toolbar can
// produce (src/components/campaigns/rich-text-editor.tsx) — nothing more.
const BODY_ALLOWED_TAGS = ["p", "br", "b", "strong", "i", "em", "u", "s", "strike", "ul", "ol", "li", "blockquote", "span", "div", "a"];
const BODY_ALLOWED_STYLES = {
  "*": {
    color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(.*\)$/],
    "font-family": [/^[a-zA-Z0-9 ,'"-]+$/],
    "font-size": [/^\d+(px|pt|em|rem)$/],
    "text-align": [/^(left|center|right|justify)$/],
  },
};

function sanitizeBodyHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: BODY_ALLOWED_TAGS,
    allowedAttributes: { "*": ["style"], a: ["href"] },
    allowedStyles: BODY_ALLOWED_STYLES,
    allowedSchemesByTag: { a: ["http", "https"] },
  });
}

// --- HTML-format path ---------------------------------------------------
// A second, wider — but still fully sanitized — allowlist for full HTML
// email documents (tables, images, a <style> block for responsive media
// queries). Sanitization stays mandatory for both formats; this is not a
// verbatim-trust escape hatch, just a bigger allowlist.
const HTML_ALLOWED_TAGS = [
  ...BODY_ALLOWED_TAGS,
  "html", "head", "body", "meta", "title", "style",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "center",
];
const HTML_ALLOWED_ATTRIBUTES = {
  "*": ["style", "class", "id"],
  a: ["href", "target"],
  img: ["src", "alt", "width", "height"],
  table: ["align", "valign", "border", "cellpadding", "cellspacing", "role", "width"],
  td: ["align", "valign", "colspan", "rowspan", "width"],
  th: ["align", "valign", "colspan", "rowspan", "width"],
  tr: ["align", "valign"],
};
const HTML_ALLOWED_STYLES = {
  "*": {
    ...BODY_ALLOWED_STYLES["*"],
    "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(.*\)$/],
    // MJML emits the `background` shorthand (not just `background-color`) on
    // some elements, e.g. the mj-social icon badges — without this,
    // sanitize-html drops the whole declaration and the badge's colored
    // circle disappears, leaving a bare letter with no background at all.
    background: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(.*\)$/],
    "font-weight": [/^(normal|bold|[1-9]00)$/],
    "font-style": [/^(normal|italic)$/],
    "text-decoration": [/^[a-z\- ]+$/],
    "text-transform": [/^(none|uppercase|lowercase|capitalize)$/],
    "line-height": [/^[\d.]+(px|%)?$/],
    "letter-spacing": [/^-?[\d.]+(px|em)$/],
    // "auto" is a deliberate addition (not part of the original allowlist):
    // MJML's compiled output centers every section with `margin:0px auto`
    // and sizes images with `height:auto` — without "auto" as an accepted
    // token, sanitize-html drops the whole declaration (regex mismatch),
    // which silently un-centers every MJML-compiled branded template. "auto"
    // carries no injection risk (it's a fixed CSS keyword, not attacker-
    // controlled data), so this widening is safe.
    padding: [/^[\d.]+(px|%)( [\d.]+(px|%)){0,3}$/],
    "padding-top": [/^[\d.]+(px|%)$/],
    "padding-right": [/^[\d.]+(px|%)$/],
    "padding-bottom": [/^[\d.]+(px|%)$/],
    "padding-left": [/^[\d.]+(px|%)$/],
    margin: [/^(auto|[\d.]+(px|%))( (auto|[\d.]+(px|%))){0,3}$/],
    "margin-top": [/^(auto|[\d.]+(px|%))$/],
    "margin-right": [/^(auto|[\d.]+(px|%))$/],
    "margin-bottom": [/^(auto|[\d.]+(px|%))$/],
    "margin-left": [/^(auto|[\d.]+(px|%))$/],
    width: [/^(auto|[\d.]+(px|%))$/],
    height: [/^(auto|[\d.]+(px|%))$/],
    "max-width": [/^[\d.]+(px|%)$/],
    "min-width": [/^[\d.]+(px|%)$/],
    border: [/^.+$/],
    "border-top": [/^.+$/],
    "border-right": [/^.+$/],
    "border-bottom": [/^.+$/],
    "border-left": [/^.+$/],
    "border-color": [/^.+$/],
    "border-width": [/^.+$/],
    "border-style": [/^.+$/],
    "border-radius": [/^[\d.]+(px|%)$/],
    "border-collapse": [/^(collapse|separate)$/],
    // "inline-table" is a deliberate addition: MJML lays its mj-social icons
    // out side by side as sibling <table> elements with
    // `display:inline-table` — without that value accepted, sanitize-html
    // drops the whole style attribute (float:none goes with it), each
    // table falls back to its default block-level `display:table`, and the
    // icons stack vertically instead of flowing in a row.
    display: [/^(block|inline|inline-block|inline-table|none|table|table-cell|table-row)$/],
    float: [/^(left|right|none)$/],
    "vertical-align": [/^(top|middle|bottom|baseline)$/],
    "white-space": [/^(normal|nowrap|pre)$/],
    "line-break": [/^.+$/],
    "mso-table-lspace": [/^.+$/],
    "mso-table-rspace": [/^.+$/],
  },
};

function sanitizeRawHtml(html: string): string {
  // `style` tag is deliberately allowed: sanitize-html does NOT parse or
  // filter CSS *inside* a <style> tag's text content — its rules pass
  // through verbatim. Accepted, documented tradeoff: no modern engine or
  // Outlook's Word-based renderer executes JS from CSS, and allowing it is
  // required to support the responsive mobile-stacking media query these
  // branded templates rely on. `allowVulnerableTags: true` silences
  // sanitize-html's own warning for that same already-accounted-for
  // tradeoff — it is not a bypass of it.
  //
  // Note: sanitize-html unconditionally strips ALL HTML comments — there is
  // no allowlist mechanism for them. This removes MSO conditional comments
  // (`<!--[if mso]>...<![endif]-->`), so an Outlook-only VML "bulletproof
  // button" degrades gracefully to a plain HTML button there instead of the
  // pixel-perfect rounded one. Accepted; do not attempt a comment-preserving
  // pre/post-processing pass around this sanitizer — that would reopen
  // exactly the risk "sanitization stays mandatory" is meant to close.
  //
  // Still explicitly excluded (simply absent from allowedTags, listed here
  // for auditability): script, iframe, object, embed, form, input, button,
  // svg, link.
  return sanitizeHtml(html, {
    allowedTags: HTML_ALLOWED_TAGS,
    allowedAttributes: HTML_ALLOWED_ATTRIBUTES,
    allowedStyles: HTML_ALLOWED_STYLES,
    allowedSchemesByTag: { a: ["http", "https", "mailto"], img: ["http", "https", "data"] },
    allowVulnerableTags: true,
  });
}

function htmlToPlainText(html: string): string {
  // Strip <head>/<style> content BEFORE tag-stripping below — sanitizeHtml
  // with allowedTags:[] removes tags but keeps element *text content*, so a
  // <style> block's raw CSS would otherwise leak verbatim into the plaintext
  // MIME part. Safe unconditionally: RICH_TEXT bodies never contain these
  // tags, so this is a no-op for every existing row/flow.
  const withoutHeadAndStyle = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  // Stripping tags outright would collapse every paragraph/list item into one
  // run-on line — turn block-level breaks into real newlines first.
  const withBreaks = withoutHeadAndStyle
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|div|li|blockquote|tr|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<\/td>/gi, "  ");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped.replace(/\n{3,}/g, "\n\n").trim();
}

export type ComposeEmailOptions = {
  subjectTemplate: string;
  /** HTML from the campaign body's editor — rich text fragment or a full HTML document, per bodyFormat. */
  bodyTemplate: string;
  bodyFormat: "RICH_TEXT" | "HTML";
  contact: MergeContact;
  signatureHtml?: string | null;
  /**
   * Where to point the signature logo `<img>`, if the user has one set.
   * Callers decide the mode: `"cid:signature-logo"` for a real send (paired
   * with an actual MIME attachment of that cid), or a same-origin URL like
   * `/api/settings/signature-logo` for in-browser preview, where `cid:`
   * doesn't resolve to anything.
   */
  signatureLogoSrc?: string | null;
  unsubscribeFooterText?: string | null;
  includeUnsubscribeFooter: boolean;
};

export function composeEmail(opts: ComposeEmailOptions): { subject: string; html: string; text: string } {
  const subject = renderMergeVars(opts.subjectTemplate, opts.contact);
  const renderedBody = renderMergeVars(opts.bodyTemplate, opts.contact);

  let html = opts.bodyFormat === "HTML" ? sanitizeRawHtml(renderedBody) : sanitizeBodyHtml(renderedBody);
  let text = htmlToPlainText(html);

  if (opts.signatureHtml) {
    const cleanSignature = sanitizeHtml(opts.signatureHtml, {
      allowedTags: ["b", "i", "em", "strong", "a", "br", "p", "span", "div"],
      allowedAttributes: { a: ["href"] },
    });
    html = appendBeforeBodyClose(html, `<br><br>${cleanSignature}`);
    text += `\n\n${sanitizeHtml(opts.signatureHtml, { allowedTags: [], allowedAttributes: {} })}`;
  }

  if (opts.signatureLogoSrc) {
    // System-constructed src, not user input — doesn't need to go through
    // the signature sanitizer above (which doesn't allow `img` anyway).
    html = appendBeforeBodyClose(html, `<br><img src="${opts.signatureLogoSrc}" alt="" style="max-height:60px;max-width:200px" />`);
  }

  if (opts.includeUnsubscribeFooter && opts.unsubscribeFooterText) {
    html = appendBeforeBodyClose(html, `<br><br><span style="color:#888;font-size:12px">${escapeHtml(opts.unsubscribeFooterText)}</span>`);
    text += `\n\n${opts.unsubscribeFooterText}`;
  }

  return { subject, html, text };
}
