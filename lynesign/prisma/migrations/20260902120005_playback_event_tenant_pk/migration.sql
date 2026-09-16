-- Tenant-local identity for PlaybackEvent: the primary key becomes
-- ("organizationId", "id"). The row id is client-supplied, so a bare single
-- column primary key let an id from one tenant collide with another tenant's
-- row at the index level, below RLS, where createMany({ skipDuplicates: true })
-- would silently drop it. The composite key makes the two rows distinct.
ALTER TABLE "PlaybackEvent" DROP CONSTRAINT "PlaybackEvent_pkey";
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_pkey" PRIMARY KEY ("organizationId", "id");

-- An index leading with airedAt so the hourly retention prune is a bounded
-- range scan rather than a full index scan when there is nothing to delete.
CREATE INDEX "PlaybackEvent_airedAt_idx" ON "PlaybackEvent"("airedAt");
