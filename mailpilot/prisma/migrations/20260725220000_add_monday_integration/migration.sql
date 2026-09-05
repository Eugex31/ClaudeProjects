-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "mondayDirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mondayItemId" TEXT;

-- CreateTable
CREATE TABLE "MondayIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "boardName" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MondayIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MondayIntegration_userId_key" ON "MondayIntegration"("userId");

-- CreateIndex
CREATE INDEX "Contact_userId_mondayDirty_idx" ON "Contact"("userId", "mondayDirty");

-- AddForeignKey
ALTER TABLE "MondayIntegration" ADD CONSTRAINT "MondayIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

