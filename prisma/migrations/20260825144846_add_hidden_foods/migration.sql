-- CreateTable
CREATE TABLE "HiddenFood" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenFood_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiddenFood_userId_idx" ON "HiddenFood"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HiddenFood_userId_foodItemId_key" ON "HiddenFood"("userId", "foodItemId");

-- AddForeignKey
ALTER TABLE "HiddenFood" ADD CONSTRAINT "HiddenFood_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenFood" ADD CONSTRAINT "HiddenFood_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
