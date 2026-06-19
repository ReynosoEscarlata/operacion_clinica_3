-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "noShowAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "consultationPriceCents" INTEGER NOT NULL DEFAULT 50000;
