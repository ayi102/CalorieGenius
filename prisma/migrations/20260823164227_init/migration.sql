-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('sedentary', 'light', 'moderate', 'active', 'very_active');

-- CreateEnum
CREATE TYPE "Goal" AS ENUM ('lose', 'maintain', 'gain');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('text', 'photo', 'barcode', 'restaurant', 'quickadd', 'manual');

-- CreateEnum
CREATE TYPE "FoodGroup" AS ENUM ('protein', 'grain', 'vegetable', 'fruit', 'dairy', 'fat', 'sweet', 'beverage', 'mixed_dish', 'alcohol');

-- CreateEnum
CREATE TYPE "NutritionSource" AS ENUM ('usda', 'openfoodfacts', 'estimate', 'user');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "sex" "Sex",
    "birthDate" DATE,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "activityLevel" "ActivityLevel" NOT NULL DEFAULT 'moderate',
    "goal" "Goal" NOT NULL DEFAULT 'maintain',
    "calorieTargetOverride" INTEGER,
    "proteinTargetOverride" INTEGER,
    "bedtimeMinutes" INTEGER NOT NULL DEFAULT 1380,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eatenAt" TIMESTAMPTZ(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "source" "EntrySource" NOT NULL,
    "rawText" TEXT,
    "restaurantName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryItem" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "foodItemId" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'serving',
    "grams" DOUBLE PRECISION NOT NULL,
    "kcal" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION,
    "sugar" DOUBLE PRECISION,
    "sodium" DOUBLE PRECISION,
    "foodGroup" "FoodGroup" NOT NULL,
    "processedLevel" INTEGER NOT NULL,
    "nutritionSource" "NutritionSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "usdaFdcId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "brand" TEXT,
    "restaurantName" TEXT,
    "barcode" TEXT,
    "usdaFdcId" TEXT,
    "kcalPer100g" DOUBLE PRECISION NOT NULL,
    "proteinPer100g" DOUBLE PRECISION NOT NULL,
    "carbsPer100g" DOUBLE PRECISION NOT NULL,
    "fatPer100g" DOUBLE PRECISION NOT NULL,
    "fiberPer100g" DOUBLE PRECISION,
    "sugarPer100g" DOUBLE PRECISION,
    "sodiumPer100g" DOUBLE PRECISION,
    "defaultGrams" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "foodGroup" "FoodGroup" NOT NULL,
    "processedLevel" INTEGER NOT NULL,
    "nutritionSource" "NutritionSource" NOT NULL,
    "timesLogged" INTEGER NOT NULL DEFAULT 0,
    "lastLoggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseCache" (
    "id" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParseCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "parseCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParseUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

-- CreateIndex
CREATE INDEX "Entry_userId_localDate_idx" ON "Entry"("userId", "localDate");

-- CreateIndex
CREATE INDEX "Entry_userId_eatenAt_idx" ON "Entry"("userId", "eatenAt");

-- CreateIndex
CREATE INDEX "EntryItem_entryId_idx" ON "EntryItem"("entryId");

-- CreateIndex
CREATE INDEX "EntryItem_foodItemId_idx" ON "EntryItem"("foodItemId");

-- CreateIndex
CREATE INDEX "FoodItem_userId_timesLogged_idx" ON "FoodItem"("userId", "timesLogged" DESC);

-- CreateIndex
CREATE INDEX "FoodItem_barcode_idx" ON "FoodItem"("barcode");

-- CreateIndex
CREATE INDEX "FoodItem_normalizedName_idx" ON "FoodItem"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_userId_normalizedName_brand_key" ON "FoodItem"("userId", "normalizedName", "brand");

-- CreateIndex
CREATE UNIQUE INDEX "ParseCache_textHash_key" ON "ParseCache"("textHash");

-- CreateIndex
CREATE INDEX "ParseCache_model_idx" ON "ParseCache"("model");

-- CreateIndex
CREATE UNIQUE INDEX "ParseUsage_userId_localDate_key" ON "ParseUsage"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryItem" ADD CONSTRAINT "EntryItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryItem" ADD CONSTRAINT "EntryItem_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseUsage" ADD CONSTRAINT "ParseUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
