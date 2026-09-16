-- AlterEnum
-- This runs first. Postgres 12 and later allow ALTER TYPE ... ADD VALUE inside a
-- transaction as long as the new value is not itself used later in that same
-- transaction. Nothing below references 'WEB', so the rest of this migration can
-- share the file with it.
ALTER TYPE "FrameType" ADD VALUE 'WEB';

-- AlterTable
-- Canvas gains an optimistic-concurrency counter and a soft-delete marker.
ALTER TABLE "Canvas" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "Canvas_organizationId_archivedAt_idx" ON "Canvas"("organizationId", "archivedAt");

-- Clear any background reference that does not resolve to a MediaAsset before
-- the FK lands. The Display Monkey import stored a legacy media-ref string in
-- "backgroundImageId"; testing membership against MediaAsset is exactly the
-- condition the foreign key is about to enforce.
UPDATE "Canvas" SET "backgroundImageId" = NULL WHERE "backgroundImageId" IS NOT NULL AND "backgroundImageId" NOT IN (SELECT "id" FROM "MediaAsset");

-- AddForeignKey
ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_backgroundImageId_fkey" FOREIGN KEY ("backgroundImageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Web" (
    "contentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "Web_pkey" PRIMARY KEY ("contentId")
);

-- AddForeignKey
ALTER TABLE "Web" ADD CONSTRAINT "Web_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation: Web carries organizationId and gets the same row-level
-- security policy as every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Web']
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
