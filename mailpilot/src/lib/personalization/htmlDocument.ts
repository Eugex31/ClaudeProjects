// Inserts `extra` immediately before the last </body> in `html` (case-
// insensitive) instead of blindly appending to the end of the string —
// content appended after a closing </body></html> in a full HTML document is
// fragile and non-conforming (some parsers won't render it). Falls back to a
// plain append when no </body> is present, which is always true for
// RICH_TEXT/fragment bodies, so behavior there is byte-identical to a plain
// `html + extra`.
export function appendBeforeBodyClose(html: string, extra: string): string {
  const match = /<\/body\s*>/i.exec(html);
  if (!match) return html + extra;
  return html.slice(0, match.index) + extra + html.slice(match.index);
}
