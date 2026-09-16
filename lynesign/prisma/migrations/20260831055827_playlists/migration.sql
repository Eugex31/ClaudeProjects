-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "playlistId" TEXT;

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultImageDurationSeconds" INTEGER NOT NULL DEFAULT 10,
    "defaultWebDurationSeconds" INTEGER NOT NULL DEFAULT 30,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Playlist_organizationId_idx" ON "Playlist"("organizationId");

-- CreateIndex
CREATE INDEX "Playlist_organizationId_archivedAt_idx" ON "Playlist"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "PlaylistItem_playlistId_position_idx" ON "PlaylistItem"("playlistId", "position");

-- CreateIndex
CREATE INDEX "PlaylistItem_organizationId_idx" ON "PlaylistItem"("organizationId");

-- CreateIndex
CREATE INDEX "PlaylistItem_mediaAssetId_idx" ON "PlaylistItem"("mediaAssetId");

-- CreateIndex
CREATE INDEX "Screen_playlistId_idx" ON "Screen"("playlistId");

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation: Playlist and PlaylistItem both carry organizationId and get
-- the same row-level security policy as every other tenant table. Screen already
-- has its policy from an earlier migration; only the new tables are listed here.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Playlist','PlaylistItem']
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
