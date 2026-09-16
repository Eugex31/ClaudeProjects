-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "playlistId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignScreen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,

    CONSTRAINT "CampaignScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "CampaignLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_organizationId_idx" ON "Campaign"("organizationId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_archivedAt_idx" ON "Campaign"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_enabled_startsAt_endsAt_idx" ON "Campaign"("organizationId", "enabled", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Campaign_playlistId_idx" ON "Campaign"("playlistId");

-- CreateIndex
CREATE INDEX "CampaignScreen_organizationId_idx" ON "CampaignScreen"("organizationId");

-- CreateIndex
CREATE INDEX "CampaignScreen_screenId_idx" ON "CampaignScreen"("screenId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignScreen_campaignId_screenId_key" ON "CampaignScreen"("campaignId", "screenId");

-- CreateIndex
CREATE INDEX "CampaignLocation_organizationId_idx" ON "CampaignLocation"("organizationId");

-- CreateIndex
CREATE INDEX "CampaignLocation_locationId_idx" ON "CampaignLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLocation_campaignId_locationId_key" ON "CampaignLocation"("campaignId", "locationId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScreen" ADD CONSTRAINT "CampaignScreen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScreen" ADD CONSTRAINT "CampaignScreen_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScreen" ADD CONSTRAINT "CampaignScreen_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLocation" ADD CONSTRAINT "CampaignLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLocation" ADD CONSTRAINT "CampaignLocation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLocation" ADD CONSTRAINT "CampaignLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation: Campaign, CampaignScreen and CampaignLocation all carry
-- organizationId and get the same row-level security policy as every other
-- tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Campaign','CampaignScreen','CampaignLocation']
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
