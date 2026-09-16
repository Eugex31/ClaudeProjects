-- boardId/boardName/columnMapping are unset right after OAuth connect, before
-- a board and column mapping have been chosen. Widen to nullable so that
-- "connected but not yet configured" is representable.
ALTER TABLE "MondayIntegration" ALTER COLUMN "boardId" DROP NOT NULL;
ALTER TABLE "MondayIntegration" ALTER COLUMN "boardName" DROP NOT NULL;
ALTER TABLE "MondayIntegration" ALTER COLUMN "columnMapping" DROP NOT NULL;
