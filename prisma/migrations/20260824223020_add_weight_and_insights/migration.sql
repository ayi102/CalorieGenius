-- CreateTable
CREATE TABLE "WeightLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeightLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeightLog_userId_localDate_idx" ON "WeightLog"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeightLog_userId_localDate_key" ON "WeightLog"("userId", "localDate");

-- CreateIndex
CREATE INDEX "Insight_userId_periodStart_idx" ON "Insight"("userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Insight_userId_periodStart_key" ON "Insight"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "WeightLog" ADD CONSTRAINT "WeightLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
