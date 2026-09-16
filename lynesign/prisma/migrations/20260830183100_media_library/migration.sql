-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'WEB');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaJobStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Picture" ADD COLUMN     "mediaAssetId" TEXT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "mediaAssetId" TEXT;

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folderId" TEXT,
    "kind" "MediaKind" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "name" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "storageKey" TEXT,
    "thumbnailKey" TEXT,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" INTEGER,
    "url" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaProcessingJob" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "status" "MediaJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MediaProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaFolder_organizationId_idx" ON "MediaFolder"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFolder_organizationId_parentId_name_key" ON "MediaFolder"("organizationId", "parentId", "name");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_folderId_idx" ON "MediaAsset"("organizationId", "folderId");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_kind_idx" ON "MediaAsset"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_checksum_idx" ON "MediaAsset"("organizationId", "checksum");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_status_idx" ON "MediaAsset"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MediaProcessingJob_mediaAssetId_key" ON "MediaProcessingJob"("mediaAssetId");

-- CreateIndex
CREATE INDEX "MediaProcessingJob_status_createdAt_idx" ON "MediaProcessingJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Picture" ADD CONSTRAINT "Picture_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation: MediaFolder and MediaAsset carry organizationId and get the
-- same row-level security policy as every other tenant table. MediaProcessingJob
-- is global (no organizationId) and is deliberately absent from this ARRAY.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MediaFolder','MediaAsset']
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
