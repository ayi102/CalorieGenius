-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "waterTargetMl" INTEGER;

-- CreateTable
CREATE TABLE "WaterLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "drankAt" TIMESTAMPTZ(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "ml" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaterLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaterLog_userId_localDate_idx" ON "WaterLog"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "WaterLog" ADD CONSTRAINT "WaterLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
