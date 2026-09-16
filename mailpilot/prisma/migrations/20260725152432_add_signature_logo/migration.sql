-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "signatureLogo" BYTEA,
ADD COLUMN     "signatureLogoContentType" TEXT,
ADD COLUMN     "signatureLogoFilename" TEXT;
