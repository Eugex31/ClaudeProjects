-- CreateEnum
CREATE TYPE "BodyFormat" AS ENUM ('RICH_TEXT', 'HTML');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "bodyFormat" "BodyFormat" NOT NULL DEFAULT 'RICH_TEXT';

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "bodyFormat" "BodyFormat" NOT NULL DEFAULT 'RICH_TEXT';

-- AlterTable
ALTER TABLE "StarterTemplate" ADD COLUMN     "bodyFormat" "BodyFormat" NOT NULL DEFAULT 'RICH_TEXT';

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "bodyFormat" "BodyFormat" NOT NULL DEFAULT 'RICH_TEXT';
