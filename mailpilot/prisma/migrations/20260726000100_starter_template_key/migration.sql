-- AlterTable
ALTER TABLE "StarterTemplate" ADD COLUMN     "key" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "StarterTemplate_key_key" ON "StarterTemplate"("key");

