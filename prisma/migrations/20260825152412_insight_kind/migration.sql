-- Insight gains a `kind`, so the weekly review and the long-window pattern
-- analysis can coexist: they cover different periods and cannot share a cache
-- key. Existing rows default to 'weekly', which is what all of them are.
-- DropIndex
DROP INDEX "Insight_userId_periodStart_idx";

-- DropIndex
DROP INDEX "Insight_userId_periodStart_key";

-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'weekly';

-- CreateIndex
CREATE INDEX "Insight_userId_kind_periodStart_idx" ON "Insight"("userId", "kind", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Insight_userId_kind_periodStart_key" ON "Insight"("userId", "kind", "periodStart");

