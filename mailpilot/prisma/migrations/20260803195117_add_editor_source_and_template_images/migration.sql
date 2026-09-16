-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "editorSource" TEXT;

-- CreateTable
CREATE TABLE "TemplateImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "filename" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateImage_userId_idx" ON "TemplateImage"("userId");

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
