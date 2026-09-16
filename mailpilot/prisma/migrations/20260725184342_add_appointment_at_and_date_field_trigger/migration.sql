-- AlterEnum
ALTER TYPE "SequenceTriggerType" ADD VALUE 'DATE_FIELD';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "appointmentAt" TIMESTAMPTZ(3);
