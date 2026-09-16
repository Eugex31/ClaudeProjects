-- Prisma's `@@unique([organizationId, parentId, name])` on MediaFolder does not
-- constrain root folders: Postgres treats NULL as distinct, so two rows with
-- `parentId IS NULL` and the same name do not collide. Enforce the same
-- uniqueness for root folders with a partial unique index, which the Prisma
-- schema language cannot express.
CREATE UNIQUE INDEX "MediaFolder_organizationId_name_root_key" ON "MediaFolder" ("organizationId", "name") WHERE "parentId" IS NULL;
