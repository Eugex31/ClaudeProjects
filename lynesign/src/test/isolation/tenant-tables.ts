/**
 * Every table that carries `organizationId` and is therefore RLS-scoped, in
 * PascalCase (the Postgres relation name). This is one of three hand-maintained
 * lists that must agree: this one, `TENANT_MODELS` in `src/lib/db/tenant.ts`
 * (camelCase Prisma model names), and the `ARRAY[...]` union in the RLS
 * migrations. `tenant-model-list.test.ts` cross-checks all three.
 *
 * Kept in a plain module (not a `*.test.ts`) so importing it never drags a
 * suite's `describe` blocks into another test file.
 */
export const TENANT_TABLES: string[] = [
  "Membership", "Invitation", "Subscription", "AuditLog", "Location", "Screen",
  "Canvas", "Panel", "Frame", "FrameLocation", "Content", "Clock", "Picture",
  "Video", "Youtube", "Html", "Web", "Memo", "Outlook", "Report", "Powerbi", "Weather",
  "News", "LegacyIntegration", "MediaFolder", "MediaAsset", "Playlist",
  "PlaylistItem", "Campaign", "CampaignScreen", "CampaignLocation",
  "ScheduleRule", "ScheduleRuleScreen", "ScheduleRuleLocation",
  "PlaybackEvent",
];
