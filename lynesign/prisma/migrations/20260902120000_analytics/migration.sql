-- CreateTable
CREATE TABLE "PlaybackEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "playlistId" TEXT,
    "source" TEXT NOT NULL,
    "campaignId" TEXT,
    "scheduleRuleId" TEXT,
    "airedAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybackEvent_organizationId_airedAt_idx" ON "PlaybackEvent"("organizationId", "airedAt");

-- CreateIndex
CREATE INDEX "PlaybackEvent_organizationId_mediaAssetId_airedAt_idx" ON "PlaybackEvent"("organizationId", "mediaAssetId", "airedAt");

-- CreateIndex
CREATE INDEX "PlaybackEvent_organizationId_campaignId_airedAt_idx" ON "PlaybackEvent"("organizationId", "campaignId", "airedAt");

-- CreateIndex
CREATE INDEX "PlaybackEvent_organizationId_scheduleRuleId_airedAt_idx" ON "PlaybackEvent"("organizationId", "scheduleRuleId", "airedAt");

-- CreateIndex
CREATE INDEX "PlaybackEvent_screenId_airedAt_idx" ON "PlaybackEvent"("screenId", "airedAt");

-- AddForeignKey
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "ScheduleRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Duration is a non-negative count of seconds and cannot exceed one day
-- (86400s). Prisma's schema cannot express this, so it lives here.
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "playback_event_duration_nonneg"
  CHECK ("durationSeconds" >= 0 AND "durationSeconds" <= 86400);

-- Tenant isolation: PlaybackEvent carries organizationId and gets the same
-- row-level security policy as every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PlaybackEvent']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (
        coalesce(current_setting('app.current_org', true), '') = ''
        OR "organizationId" = current_setting('app.current_org', true)
      )
      WITH CHECK (
        coalesce(current_setting('app.current_org', true), '') = ''
        OR "organizationId" = current_setting('app.current_org', true)
      )
    $f$, t);
  END LOOP;
END $$;
