-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('OPEN', 'CLICK');

-- AlterTable: trackingToken is added nullable first, backfilled for existing
-- rows with a real random UUID (Prisma's @default(uuid()) is a Prisma
-- Client-side default, not a Postgres column default, so it never applies to
-- rows that already exist), then locked to NOT NULL + UNIQUE.
ALTER TABLE "CampaignRecipient" ADD COLUMN     "trackingToken" TEXT;

UPDATE "CampaignRecipient" SET "trackingToken" = gen_random_uuid()::text WHERE "trackingToken" IS NULL;

ALTER TABLE "CampaignRecipient" ALTER COLUMN "trackingToken" SET NOT NULL;

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "url" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailEvent_campaignId_type_idx" ON "EmailEvent"("campaignId", "type");

-- CreateIndex
CREATE INDEX "EmailEvent_recipientId_type_idx" ON "EmailEvent"("recipientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_trackingToken_key" ON "CampaignRecipient"("trackingToken");

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
