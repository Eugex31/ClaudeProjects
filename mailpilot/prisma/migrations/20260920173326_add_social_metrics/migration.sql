-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "followerCount" INTEGER,
ADD COLUMN     "followerCountAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "commentCount" INTEGER,
ADD COLUMN     "likeCount" INTEGER,
ADD COLUMN     "metricsFetchedAt" TIMESTAMPTZ(3),
ADD COLUMN     "shareCount" INTEGER,
ADD COLUMN     "viewCount" INTEGER;

-- CreateTable
CREATE TABLE "SocialFollowerSnapshot" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "followerCount" INTEGER NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialFollowerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialFollowerSnapshot_socialAccountId_capturedAt_idx" ON "SocialFollowerSnapshot"("socialAccountId", "capturedAt");

-- AddForeignKey
ALTER TABLE "SocialFollowerSnapshot" ADD CONSTRAINT "SocialFollowerSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
