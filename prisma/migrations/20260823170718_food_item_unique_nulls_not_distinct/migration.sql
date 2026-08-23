-- Postgres treats NULLs as DISTINCT in a unique index, so the Prisma-generated
-- "FoodItem_userId_normalizedName_brand_key" does not actually dedupe the rows
-- that matter most here: shared library entries, which have userId IS NULL, and
-- unbranded foods, which have brand IS NULL. Without this, every lookup of a
-- shared food would insert another duplicate.
--
-- NULLS NOT DISTINCT (Postgres 15+) makes NULL compare equal to NULL for
-- uniqueness. The replacement keeps the SAME index name so Prisma still sees the
-- unique constraint its schema declares and does not report drift — Prisma
-- cannot express the NULLS NOT DISTINCT flag itself.
DROP INDEX IF EXISTS "FoodItem_userId_normalizedName_brand_key";

CREATE UNIQUE INDEX "FoodItem_userId_normalizedName_brand_key"
  ON "FoodItem" ("userId", "normalizedName", "brand")
  NULLS NOT DISTINCT;
