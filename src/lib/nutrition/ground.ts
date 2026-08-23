/**
 * Replace estimated nutrition with measured nutrition where possible.
 *
 * Order of preference, best first:
 *   1. FoodItem cache      — already resolved once; free and instant
 *   2. USDA FoodData Central — laboratory values for whole/generic foods
 *   3. The model's estimate  — the honest fallback, flagged as such
 *
 * A failure at any external step is NOT an error: it falls through to the
 * estimate. Losing someone's food log because a third-party API was slow would
 * be a far worse outcome than an approximate calorie count.
 */

import { prisma } from "@/lib/prisma";
import { normalizeFoodName, scaleFrom100g, to100gBasis } from "./normalize";
import { searchUsda } from "./usda";
import type { FoodGroup, Nutrition, ParsedItem } from "./types";

export type NutritionSource = "usda" | "openfoodfacts" | "estimate" | "user";

export interface GroundedItem {
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  grams: number;
  nutrition: Nutrition;
  foodGroup: FoodGroup;
  processedLevel: number;
  nutritionSource: NutritionSource;
  confidence: number;
  usdaFdcId: string | null;
  /** Set when an existing library row supplied the numbers. */
  foodItemId: string | null;
  /** Human-readable provenance for the UI. */
  provenance: string;
  /**
   * True when grounding was attempted but the lookup itself failed (timeout,
   * outage, rate limit) rather than simply not matching. Surfaced so the user
   * can retry instead of silently accepting a weaker number.
   */
  lookupUnavailable: boolean;
}

/**
 * Overall budget for one USDA lookup, covering all retry attempts.
 *
 * USDA needs retries to be reliable (see usda.ts), so this has to be wider than
 * a single request — but it is still a hard ceiling, because a slow database
 * must never hold up someone logging their lunch.
 */
const USDA_TIMEOUT_MS = 8000;

function scaleNutrition(per100g: Nutrition, grams: number): Nutrition {
  return {
    kcal: scaleFrom100g(per100g.kcal, grams),
    protein: scaleFrom100g(per100g.protein, grams),
    carbs: scaleFrom100g(per100g.carbs, grams),
    fat: scaleFrom100g(per100g.fat, grams),
    fiber: scaleFrom100g(per100g.fiber, grams),
    sugar: scaleFrom100g(per100g.sugar, grams),
    sodium: scaleFrom100g(per100g.sodium, grams),
  };
}

/**
 * Sanity-check a USDA match against the model's own estimate.
 *
 * A wildly different calorie density usually means the search matched the wrong
 * food (e.g. "chicken" -> "chicken fat"). Trusting the estimate in that case is
 * safer than trusting a confidently-wrong database row.
 */
function densityIsPlausible(usda: Nutrition, estimate: Nutrition, grams: number): boolean {
  const estimated = estimate.kcal;
  if (estimated <= 0 || grams <= 0) return true; // nothing to compare against
  const scaled = scaleFrom100g(usda.kcal, grams);
  const ratio = scaled / estimated;
  return ratio >= 0.4 && ratio <= 2.5;
}

/**
 * Ground one parsed item.
 *
 * `userId` scopes the FoodItem cache lookup: a user's own corrected version of a
 * food must win over the shared row, and must never leak to another user.
 */
export async function groundItem(
  userId: string,
  item: ParsedItem,
  options: { restaurantName?: string | null } = {},
): Promise<GroundedItem> {
  const normalized = normalizeFoodName(item.name);
  const isRestaurant = Boolean(options.restaurantName ?? null);

  const base = {
    name: item.name,
    brand: item.brand,
    quantity: item.quantity,
    unit: item.unit,
    grams: item.grams,
    foodGroup: item.foodGroup as FoodGroup,
    processedLevel: item.processedLevel,
    confidence: item.confidence,
  };

  // --- 1. FoodItem cache. Prefer the user's own row over the shared one. ---
  try {
    const cachedFood = await prisma.foodItem.findFirst({
      where: {
        normalizedName: normalized,
        brand: item.brand,
        // The user's own corrected row, or the shared one.
        OR: [{ userId }, { userId: null }],
      },
      // Postgres sorts NULLs last for ASC, so a user-owned row is returned ahead
      // of the shared row — a correction always wins.
      orderBy: [{ userId: "asc" }],
    });

    if (cachedFood) {
      const per100g: Nutrition = {
        kcal: cachedFood.kcalPer100g,
        protein: cachedFood.proteinPer100g,
        carbs: cachedFood.carbsPer100g,
        fat: cachedFood.fatPer100g,
        fiber: cachedFood.fiberPer100g ?? 0,
        sugar: cachedFood.sugarPer100g ?? 0,
        sodium: cachedFood.sodiumPer100g ?? 0,
      };
      return {
        ...base,
        nutrition: scaleNutrition(per100g, item.grams),
        nutritionSource: cachedFood.nutritionSource as NutritionSource,
        usdaFdcId: cachedFood.usdaFdcId,
        foodItemId: cachedFood.id,
        lookupUnavailable: false,
        provenance:
          cachedFood.nutritionSource === "user"
            ? "Your correction"
            : cachedFood.nutritionSource === "usda"
              ? "USDA (cached)"
              : "Cached",
      };
    }
  } catch {
    // A cache miss must never block an entry.
  }

  // --- 2. USDA. Skipped for restaurant dishes, where coverage is weakest and
  // the model's estimate is genuinely better. ---
  const shouldTryUsda = !isRestaurant && item.usdaSearchQuery.trim() !== "";
  let lookupUnavailable = false;

  if (shouldTryUsda) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), USDA_TIMEOUT_MS);
      const match = await searchUsda(item.usdaSearchQuery, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (match && densityIsPlausible(match.per100g, item.estimatedNutrition, item.grams)) {
        const grounded = scaleNutrition(match.per100g, item.grams);

        // Write back to the shared library so the next lookup is free.
        const saved = await upsertFoodItem({
          userId: null,
          normalizedName: normalized,
          displayName: item.name,
          brand: item.brand,
          per100g: match.per100g,
          defaultGrams: item.grams,
          foodGroup: item.foodGroup as FoodGroup,
          processedLevel: item.processedLevel,
          nutritionSource: "usda",
          usdaFdcId: match.fdcId,
        });

        return {
          ...base,
          nutrition: grounded,
          nutritionSource: "usda",
          usdaFdcId: match.fdcId,
          foodItemId: saved?.id ?? null,
          lookupUnavailable: false,
          // Confidence rises because the numbers are now measured, even though
          // the portion is still the model's estimate.
          confidence: Math.max(item.confidence, 0.85),
          provenance: `USDA: ${match.description}`,
        };
      }
    } catch {
      // Timeout, rate limit, or outage — fall through to the estimate, but
      // remember that we never actually got an answer.
      lookupUnavailable = true;
    }
  }

  // --- 3. The model's estimate, honestly labelled. ---
  const saved = await upsertFoodItem({
    userId: null,
    normalizedName: normalized,
    displayName: item.name,
    brand: item.brand,
    per100g: {
      kcal: to100gBasis(item.estimatedNutrition.kcal, item.grams),
      protein: to100gBasis(item.estimatedNutrition.protein, item.grams),
      carbs: to100gBasis(item.estimatedNutrition.carbs, item.grams),
      fat: to100gBasis(item.estimatedNutrition.fat, item.grams),
      fiber: to100gBasis(item.estimatedNutrition.fiber, item.grams),
      sugar: to100gBasis(item.estimatedNutrition.sugar, item.grams),
      sodium: to100gBasis(item.estimatedNutrition.sodium, item.grams),
    },
    defaultGrams: item.grams,
    foodGroup: item.foodGroup as FoodGroup,
    processedLevel: item.processedLevel,
    nutritionSource: "estimate",
    usdaFdcId: null,
    restaurantName: options.restaurantName ?? null,
  });

  return {
    ...base,
    nutrition: item.estimatedNutrition,
    nutritionSource: "estimate",
    usdaFdcId: null,
    foodItemId: saved?.id ?? null,
    lookupUnavailable,
    provenance: isRestaurant
      ? "Estimated (restaurant)"
      : lookupUnavailable
        ? "Estimated — food database unavailable"
        : "Estimated",
  };
}

/**
 * Insert or refresh a library row. Best-effort: a write failure here degrades
 * caching, not correctness, so it is swallowed.
 */
async function upsertFoodItem(input: {
  userId: string | null;
  normalizedName: string;
  displayName: string;
  brand: string | null;
  per100g: Nutrition;
  defaultGrams: number;
  foodGroup: FoodGroup;
  processedLevel: number;
  nutritionSource: NutritionSource;
  usdaFdcId: string | null;
  restaurantName?: string | null;
}): Promise<{ id: string } | null> {
  // Deliberately NOT prisma.upsert(). The unique key includes nullable columns,
  // and Prisma renders a null in a compound-unique `where` as `= NULL`, which is
  // never true in SQL — the upsert would never match an existing shared row and
  // would insert a duplicate on every lookup. A find-then-write is explicit and
  // correct; the NULLS NOT DISTINCT index in the database is what makes it safe
  // under concurrency.
  try {
    const existing = await prisma.foodItem.findFirst({
      where: {
        normalizedName: input.normalizedName,
        brand: input.brand,
        userId: input.userId,
      },
      select: { id: true, nutritionSource: true },
    });

    if (existing) {
      // A user's own correction is authoritative and must never be overwritten
      // by an automated source.
      const mayOverwrite =
        existing.nutritionSource !== "user" && input.nutritionSource === "usda";

      return await prisma.foodItem.update({
        where: { id: existing.id },
        data: {
          timesLogged: { increment: 1 },
          lastLoggedAt: new Date(),
          ...(mayOverwrite
            ? {
                kcalPer100g: input.per100g.kcal,
                proteinPer100g: input.per100g.protein,
                carbsPer100g: input.per100g.carbs,
                fatPer100g: input.per100g.fat,
                fiberPer100g: input.per100g.fiber,
                sugarPer100g: input.per100g.sugar,
                sodiumPer100g: input.per100g.sodium,
                nutritionSource: "usda" as const,
                usdaFdcId: input.usdaFdcId,
              }
            : {}),
        },
        select: { id: true },
      });
    }

    return await prisma.foodItem.create({
      data: {
        userId: input.userId,
        normalizedName: input.normalizedName,
        displayName: input.displayName,
        brand: input.brand,
        restaurantName: input.restaurantName ?? null,
        kcalPer100g: input.per100g.kcal,
        proteinPer100g: input.per100g.protein,
        carbsPer100g: input.per100g.carbs,
        fatPer100g: input.per100g.fat,
        fiberPer100g: input.per100g.fiber,
        sugarPer100g: input.per100g.sugar,
        sodiumPer100g: input.per100g.sodium,
        defaultGrams: input.defaultGrams,
        foodGroup: input.foodGroup,
        processedLevel: input.processedLevel,
        nutritionSource: input.nutritionSource,
        usdaFdcId: input.usdaFdcId,
        timesLogged: 1,
        lastLoggedAt: new Date(),
      },
      select: { id: true },
    });
  } catch {
    // Two concurrent parses of the same new food: one wins the unique index and
    // the other lands here. Re-read rather than fail the entry.
    try {
      return await prisma.foodItem.findFirst({
        where: {
          normalizedName: input.normalizedName,
          brand: input.brand,
          userId: input.userId,
        },
        select: { id: true },
      });
    } catch {
      return null;
    }
  }
}
