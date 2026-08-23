/**
 * Open Food Facts client — barcode lookup.
 *
 * The most accurate path in this app: it reads a manufacturer's declared label
 * panel rather than estimating anything. Free and unauthenticated, but with two
 * hard constraints:
 *
 *  - **15 requests/minute per IP.** So this is only ever called for an explicit
 *    scan, never speculatively, and results are cached by barcode in FoodItem.
 *  - **A custom User-Agent is mandatory** (`AppName/1.0 (contact@email)`), or
 *    requests are treated as bot traffic. That address leaves this machine on
 *    every call, which is why it is configured rather than hardcoded.
 *
 * Server-side only — the browser must never call this directly, both for the
 * User-Agent requirement and to keep `connect-src 'self'` intact.
 */

import { env } from "@/lib/env";
import type { FoodGroup, Nutrition } from "./types";

const BASE = "https://world.openfoodfacts.org/api/v3";

export interface OffProduct {
  barcode: string
  name: string;
  brand: string | null;
  /** Nutrition per 100 g, in this app's canonical units. */
  per100g: Nutrition;
  /** A real serving weight when the label declares one, else 100 g. */
  defaultGrams: number;
  foodGroup: FoodGroup;
  processedLevel: number;
  /** True when processedLevel was inferred rather than declared. */
  processedLevelInferred: boolean;
}

/**
 * Map Open Food Facts category tags to this app's coarse groups.
 *
 * Ordered most-specific first: a chocolate milk drink should read as a beverage,
 * not as dairy, so beverages are tested before dairy.
 */
const GROUP_RULES: [FoodGroup, string[]][] = [
  ["alcohol", ["alcoholic-beverages", "beers", "wines", "spirits"]],
  ["beverage", ["beverages", "waters", "sodas", "juices", "coffees", "teas"]],
  ["sweet", ["sweet-snacks", "confectioneries", "chocolates", "biscuits", "desserts", "candies", "sweet-spreads", "ice-cream"]],
  ["dairy", ["dairies", "milks", "cheeses", "yogurts", "fermented-milk-products"]],
  ["protein", ["meats", "fishes", "seafood", "eggs", "legumes", "nuts", "meat-analogues", "poultry"]],
  ["fruit", ["fruits", "berries"]],
  ["vegetable", ["vegetables", "salads", "potatoes"]],
  ["grain", ["cereals", "breads", "pastas", "rices", "breakfast-cereals", "cereals-and-potatoes"]],
  ["fat", ["fats", "vegetable-oils", "butters", "olive-oils"]],
];

function inferFoodGroup(tags: string[]): FoodGroup {
  const bare = tags
    .filter((t) => t.startsWith("en:"))
    .map((t) => t.slice(3));

  for (const [group, keywords] of GROUP_RULES) {
    if (bare.some((tag) => keywords.some((k) => tag.includes(k)))) return group;
  }
  // Unknown packaged food: "mixed_dish" is the honest answer, not a guess at a
  // specific group.
  return "mixed_dish";
}

/**
 * Pull a serving weight out of OFF's free-text serving_size.
 *
 * Values look like "3/4 cup (28 g) (28 g)" or "330 ml" — messy, so take the LAST
 * parenthesised gram figure if present, else the first bare number with a unit.
 * Returns null rather than guessing, so the caller can fall back to 100 g.
 *
 * Note `product_quantity` is deliberately NOT used: that is the size of the whole
 * package, and treating it as a portion would log an entire tub of Nutella.
 */
export function parseServingGrams(servingSize: string | null | undefined): number | null {
  if (!servingSize) return null;

  const parenthesised = [...servingSize.matchAll(/\(\s*([\d.]+)\s*(g|ml)\s*\)/gi)];
  if (parenthesised.length > 0) {
    const n = Number(parenthesised[parenthesised.length - 1][1]);
    if (Number.isFinite(n) && n > 0 && n <= 2000) return n;
  }

  const bare = /([\d.]+)\s*(g|ml)\b/i.exec(servingSize);
  if (bare) {
    const n = Number(bare[1]);
    if (Number.isFinite(n) && n > 0 && n <= 2000) return n;
  }
  return null;
}

interface OffNutriments {
  "energy-kcal_100g"?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sugars_100g?: number;
  /** GRAMS in Open Food Facts, unlike USDA which reports milligrams. */
  sodium_100g?: number;
  salt_100g?: number;
}

const num = (v: number | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * Look up a barcode. Returns null when the product is unknown.
 *
 * Retries only on 429 and 5xx — a 404 here means "not in the database", which is
 * a real answer and must not be hammered.
 */
export async function lookupBarcode(
  barcode: string,
  options: { signal?: AbortSignal } = {},
): Promise<OffProduct | null> {
  const clean = barcode.replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 14) return null;

  const url = `${BASE}/product/${clean}.json`;
  const headers = { "User-Agent": env.offUserAgent(), Accept: "application/json" };

  let res: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(url, { headers, signal: options.signal });
    if (res.ok || (res.status !== 429 && res.status < 500)) break;
    // Back off generously: the published limit is 15/min, so being impatient
    // here risks an IP ban rather than a slow response.
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }

  if (!res || !res.ok) {
    if (res && res.status === 404) return null;
    throw new Error(`Open Food Facts lookup failed: ${res?.status ?? "no response"}`);
  }

  const data = (await res.json()) as {
    status?: string;
    product?: {
      product_name?: string;
      product_name_en?: string;
      brands?: string;
      serving_size?: string;
      nova_group?: number | null;
      categories_tags?: string[];
      nutriments?: OffNutriments;
    };
  };

  const p = data.product;
  if (data.status !== "success" || !p) return null;

  const n = p.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]);
  // Without energy there is nothing to log; treat it as not found rather than
  // saving a zero-calorie food.
  if (kcal <= 0) return null;

  // Prefer explicit sodium; fall back to salt / 2.5 (the standard conversion).
  // Both arrive in grams here, so convert to this app's canonical milligrams.
  const sodiumG =
    n.sodium_100g !== undefined ? num(n.sodium_100g) : num(n.salt_100g) / 2.5;

  const declaredNova =
    typeof p.nova_group === "number" && p.nova_group >= 1 && p.nova_group <= 4
      ? p.nova_group
      : null;

  return {
    barcode: clean,
    name: p.product_name_en || p.product_name || `Item ${clean}`,
    brand: p.brands?.split(",")[0]?.trim() || null,
    per100g: {
      kcal,
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
      fiber: num(n.fiber_100g),
      sugar: num(n.sugars_100g),
      sodium: sodiumG * 1000,
    },
    defaultGrams: parseServingGrams(p.serving_size) ?? 100,
    foodGroup: inferFoodGroup(p.categories_tags ?? []),
    // A barcoded, packaged product without a declared NOVA group is far more
    // likely to be processed than whole, so 4 is the better prior than 1 — but
    // it is flagged as inferred and stays editable.
    processedLevel: declaredNova ?? 4,
    processedLevelInferred: declaredNova === null,
  };
}
