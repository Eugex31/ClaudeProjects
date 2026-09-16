-- CreateTable
CREATE TABLE "ScheduleRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "playlistId" TEXT,
    "campaignId" TEXT,
    "daysOfWeek" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "effectiveFrom" DATE,
    "effectiveUntil" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ScheduleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRuleScreen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleRuleId" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,

    CONSTRAINT "ScheduleRuleScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRuleLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleRuleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "ScheduleRuleLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleRule_organizationId_idx" ON "ScheduleRule"("organizationId");

-- CreateIndex
CREATE INDEX "ScheduleRule_organizationId_enabled_archivedAt_idx" ON "ScheduleRule"("organizationId", "enabled", "archivedAt");

-- CreateIndex
CREATE INDEX "ScheduleRule_playlistId_idx" ON "ScheduleRule"("playlistId");

-- CreateIndex
CREATE INDEX "ScheduleRule_campaignId_idx" ON "ScheduleRule"("campaignId");

-- CreateIndex
CREATE INDEX "ScheduleRuleScreen_organizationId_idx" ON "ScheduleRuleScreen"("organizationId");

-- CreateIndex
CREATE INDEX "ScheduleRuleScreen_screenId_idx" ON "ScheduleRuleScreen"("screenId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRuleScreen_scheduleRuleId_screenId_key" ON "ScheduleRuleScreen"("scheduleRuleId", "screenId");

-- CreateIndex
CREATE INDEX "ScheduleRuleLocation_organizationId_idx" ON "ScheduleRuleLocation"("organizationId");

-- CreateIndex
CREATE INDEX "ScheduleRuleLocation_locationId_idx" ON "ScheduleRuleLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRuleLocation_scheduleRuleId_locationId_key" ON "ScheduleRuleLocation"("scheduleRuleId", "locationId");

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleScreen" ADD CONSTRAINT "ScheduleRuleScreen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleScreen" ADD CONSTRAINT "ScheduleRuleScreen_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "ScheduleRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleScreen" ADD CONSTRAINT "ScheduleRuleScreen_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleLocation" ADD CONSTRAINT "ScheduleRuleLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleLocation" ADD CONSTRAINT "ScheduleRuleLocation_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "ScheduleRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRuleLocation" ADD CONSTRAINT "ScheduleRuleLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one payload: a rule points at a playlist or a campaign, never both,
-- never neither. Prisma's schema cannot express this, so it lives here.
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "schedule_rule_payload_xor"
  CHECK ((("playlistId" IS NOT NULL)::int + ("campaignId" IS NOT NULL)::int) = 1);

-- Minute-of-day bounds. startMinute is an inclusive 0..1439, endMinute is an
-- inclusive 1..1440 (1440 means end of day), and the window is non-empty.
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "schedule_rule_minute_bounds"
  CHECK ("startMinute" >= 0 AND "startMinute" <= 1439 AND "endMinute" >= 1 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

-- Tenant isolation: ScheduleRule, ScheduleRuleScreen and ScheduleRuleLocation
-- all carry organizationId and get the same row-level security policy as every
-- other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ScheduleRule','ScheduleRuleScreen','ScheduleRuleLocation']
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
