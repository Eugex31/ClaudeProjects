-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "socialAccountLimit" INTEGER NOT NULL DEFAULT -1;

-- CreateTable
CREATE TABLE "MetaIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MetaIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metaIdentityId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaIdentity_userId_key" ON "MetaIdentity"("userId");

-- CreateIndex
CREATE INDEX "SocialAccount_userId_idx" ON "SocialAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_platform_externalAccountId_key" ON "SocialAccount"("userId", "platform", "externalAccountId");

-- AddForeignKey
ALTER TABLE "MetaIdentity" ADD CONSTRAINT "MetaIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_metaIdentityId_fkey" FOREIGN KEY ("metaIdentityId") REFERENCES "MetaIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
