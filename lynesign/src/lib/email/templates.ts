/**
 * Transactional email bodies. Copy rules: plain language, no em dashes, no
 * emojis, no exclamation points. Brand ink is #1B2A45, muted text is #6B7280.
 */

const BRAND_INK = "#1B2A45";
const MUTED = "#6B7280";

/**
 * Escape a dynamic value before it lands in HTML. Every value interpolated into
 * a template below is caller-controlled (an org member picks the organization
 * name; the URL carries a token), so each one is escaped for both element text
 * and double-quoted attribute contexts.
 */
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const wrap = (title: string, body: string): string =>
  `<div style="font-family:Inter,Arial,sans-serif;color:${BRAND_INK};line-height:1.5">` +
  `<h2 style="color:${BRAND_INK};margin:0 0 12px">${title}</h2>` +
  `${body}` +
  `<p style="color:${MUTED};font-size:13px;margin-top:24px">LyneSign</p>` +
  `</div>`;

export const invitationEmail = (orgName: string, url: string): string =>
  wrap(
    "You have been invited to LyneSign",
    `<p>${escapeHtml(orgName)} invited you to help manage their screens.</p>` +
      `<p><a href="${escapeHtml(url)}" style="color:${BRAND_INK}">Accept the invitation</a></p>` +
      `<p style="color:${MUTED};font-size:13px">This link expires in 7 days.</p>`,
  );

export const magicLinkEmail = (url: string): string =>
  wrap(
    "Sign in to LyneSign",
    `<p><a href="${escapeHtml(url)}" style="color:${BRAND_INK}">Sign in to your account</a>.</p>` +
      `<p style="color:${MUTED};font-size:13px">This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
  );

export const passwordResetEmail = (url: string): string =>
  wrap(
    "Reset your LyneSign password",
    `<p><a href="${escapeHtml(url)}" style="color:${BRAND_INK}">Choose a new password</a>.</p>` +
      `<p style="color:${MUTED};font-size:13px">This link expires in 1 hour. If you did not request it, you can ignore this email.</p>`,
  );
