-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "eatingWindowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eatingWindowEnd" INTEGER NOT NULL DEFAULT 1200,
ADD COLUMN     "eatingWindowStart" INTEGER NOT NULL DEFAULT 720;
