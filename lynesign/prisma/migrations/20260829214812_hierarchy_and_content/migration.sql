-- CreateEnum
CREATE TYPE "ScreenStatus" AS ENUM ('UNPAIRED', 'ONLINE', 'OFFLINE', 'DISABLED');

-- CreateEnum
CREATE TYPE "FrameType" AS ENUM ('CLOCK', 'PICTURE', 'VIDEO', 'YOUTUBE', 'HTML', 'MEMO', 'OUTLOOK', 'REPORT', 'POWERBI', 'WEATHER', 'NEWS');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "temperatureUnit" CHAR(1),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "pairingCode" TEXT,
    "deviceTokenHash" TEXT,
    "status" "ScreenStatus" NOT NULL DEFAULT 'UNPAIRED',
    "lastSeenAt" TIMESTAMPTZ(3),
    "canvasId" TEXT,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "orientation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Screen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Canvas" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "backgroundColor" TEXT,
    "backgroundImageId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Canvas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Panel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "name" TEXT,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "noScroll" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER NOT NULL DEFAULT 10,
    "type" "FrameType" NOT NULL,
    "locationScoped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Frame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameLocation" (
    "frameId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "FrameLocation_pkey" PRIMARY KEY ("frameId","locationId")
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "name" TEXT,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clock" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" INTEGER NOT NULL DEFAULT 0,
    "showDate" BOOLEAN NOT NULL DEFAULT true,
    "showTime" BOOLEAN NOT NULL DEFAULT true,
    "showSeconds" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "timeZone" TEXT,

    CONSTRAINT "Clock_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Picture" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mediaRef" TEXT,
    "mode" TEXT,

    CONSTRAINT "Picture_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Video" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mediaRef" TEXT,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Youtube" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "aspect" TEXT,
    "quality" TEXT,
    "rate" TEXT,

    CONSTRAINT "Youtube_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Html" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "Html_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Memo" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "Memo_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Outlook" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" INTEGER NOT NULL DEFAULT 0,
    "privacy" INTEGER NOT NULL DEFAULT 0,
    "accountRef" TEXT,

    CONSTRAINT "Outlook_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Report" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "serverRef" TEXT,
    "mode" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Powerbi" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" INTEGER NOT NULL DEFAULT 0,
    "accountRef" TEXT,

    CONSTRAINT "Powerbi_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "Weather" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" INTEGER NOT NULL DEFAULT 0,
    "provider" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Weather_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "News" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,

    CONSTRAINT "News_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "LegacyIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_legacyId_key" ON "Location"("legacyId");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Screen_legacyId_key" ON "Screen"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Screen_pairingCode_key" ON "Screen"("pairingCode");

-- CreateIndex
CREATE UNIQUE INDEX "Screen_deviceTokenHash_key" ON "Screen"("deviceTokenHash");

-- CreateIndex
CREATE INDEX "Screen_organizationId_idx" ON "Screen"("organizationId");

-- CreateIndex
CREATE INDEX "Screen_locationId_idx" ON "Screen"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Canvas_legacyId_key" ON "Canvas"("legacyId");

-- CreateIndex
CREATE INDEX "Canvas_organizationId_idx" ON "Canvas"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Panel_legacyId_key" ON "Panel"("legacyId");

-- CreateIndex
CREATE INDEX "Panel_canvasId_idx" ON "Panel"("canvasId");

-- CreateIndex
CREATE INDEX "Panel_organizationId_idx" ON "Panel"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Frame_legacyId_key" ON "Frame"("legacyId");

-- CreateIndex
CREATE INDEX "Frame_panelId_idx" ON "Frame"("panelId");

-- CreateIndex
CREATE INDEX "Frame_organizationId_idx" ON "Frame"("organizationId");

-- CreateIndex
CREATE INDEX "FrameLocation_organizationId_idx" ON "FrameLocation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Content_frameId_key" ON "Content"("frameId");

-- CreateIndex
CREATE UNIQUE INDEX "Content_legacyId_key" ON "Content"("legacyId");

-- CreateIndex
CREATE INDEX "Content_organizationId_idx" ON "Content"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyIntegration_legacyId_key" ON "LegacyIntegration"("legacyId");

-- CreateIndex
CREATE INDEX "LegacyIntegration_organizationId_idx" ON "LegacyIntegration"("organizationId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameLocation" ADD CONSTRAINT "FrameLocation_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Frame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameLocation" ADD CONSTRAINT "FrameLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Frame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clock" ADD CONSTRAINT "Clock_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Picture" ADD CONSTRAINT "Picture_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Youtube" ADD CONSTRAINT "Youtube_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Html" ADD CONSTRAINT "Html_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memo" ADD CONSTRAINT "Memo_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlook" ADD CONSTRAINT "Outlook_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Powerbi" ADD CONSTRAINT "Powerbi_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weather" ADD CONSTRAINT "Weather_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "News" ADD CONSTRAINT "News_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
