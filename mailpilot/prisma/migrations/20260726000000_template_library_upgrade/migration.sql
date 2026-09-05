-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "templateLimit" INTEGER NOT NULL DEFAULT -1;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TemplateCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarterTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StarterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarterTemplateFavorite" (
    "userId" TEXT NOT NULL,
    "starterTemplateId" TEXT NOT NULL,

    CONSTRAINT "StarterTemplateFavorite_pkey" PRIMARY KEY ("userId","starterTemplateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCategory_key_key" ON "TemplateCategory"("key");

-- CreateIndex
CREATE INDEX "StarterTemplate_categoryId_idx" ON "StarterTemplate"("categoryId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TemplateCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarterTemplate" ADD CONSTRAINT "StarterTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TemplateCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarterTemplateFavorite" ADD CONSTRAINT "StarterTemplateFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarterTemplateFavorite" ADD CONSTRAINT "StarterTemplateFavorite_starterTemplateId_fkey" FOREIGN KEY ("starterTemplateId") REFERENCES "StarterTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

