-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('imperial', 'metric');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "unitSystem" "UnitSystem" NOT NULL DEFAULT 'imperial';
