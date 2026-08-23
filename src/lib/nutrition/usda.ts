/**
 * USDA FoodData Central client — the grounding layer.
 *
 * Free, 600k+ foods, 1,000 requests/hour per IP. It cannot parse language; it
 * only looks foods up. Its job here is to replace the model's *estimated*
 * nutrient density with measured values wherever a confident match exists.
 *
 * Nutrients are read by FDC nutrient NUMBER, never by name — descriptions vary
 * ("Energy", "Energy (Atwater General Factors)") but numbers are stable.
 */

import { env } from "@/lib/env";
import { nameSimilarity } from "./normalize";
import type { Nutrition } from "./types";

const BASE = "https://api.nal.usda.gov/fdc/v1";

/** FDC nutrient numbers. Verified against live API responses. */
const NUTRIENT = {
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  kcal: 1008,
  fiber: 1079,
  sugar: 2000,
  sodium: 1093,
} as const;

/**
 * Data types in preference order.
 *
 * Foundation and SR Legacy are laboratory-analysed whole foods — the most
 * reliable per-100g values. Branded is manufacturer-submitted label data, useful
 * for packaged goods but noisier, so it is searched only as a fallback.
 *
 * "Survey (FNDDS)" is deliberately ABSENT: its parentheses break USDA's own
 * dataType parser, and including it makes every request fail with a 400/404
 * (measured 0/10 success). Do not add it back without re-testing.
 */
const PREFERRED_TYPES = "Foundation,SR Legacy";

/**
 * Build a query string encoding spaces as %20 rather than "+".
 *
 * URLSearchParams emits "+", which USDA's dataType parser does not accept. This
 * is the difference between a working request and an intermittent 400.
 */
function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%20/g, "%20")}`)
    .join("&");
}

/** Attempts per lookup, including the first. */
const MAX_ATTEMPTS = 4;

/**
 * GET with bounded retries.
 *
 * USDA's edge intermittently answers valid API requests with a 404 that carries
 * the FoodData Central HTML shell — measured at roughly a 20-60% failure rate,
 * unrelated to rate limiting (quota headers showed thousands remaining). A
 * single attempt therefore loses grounding for no good reason; four attempts
 * with short backoff recovered 9/10.
 *
 * Retries only idempotent GETs, and only on 404/408/429/5xx.
 */
async function fetchWithRetry(
  url: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("USDA lookup aborted");

    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (res.ok) return res;

    lastStatus = res.status;
    const retryable =
      res.status === 404 ||
      res.status === 408 ||
      res.status === 429 ||
      res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) break;

    // 120ms, 240ms, 480ms — enough to skip a bad edge node without making the
    // user wait noticeably.
    await new Promise((r) => setTimeout(r, 120 * 2 ** (attempt - 1)));
  }

  throw new Error(`USDA search failed after ${MAX_ATTEMPTS} attempts: ${lastStatus}`);
}

/** Minimum token overlap before a USDA hit is trusted over the model's estimate. */
export const MATCH_THRESHOLD = 0.5;

interface FdcNutrient {
  nutrientId: number;
  value: number;
  unitName: string;
}

interface FdcFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients: FdcNutrient[];
}

export interface UsdaMatch {
  fdcId: string;
  description: string;
  dataType: string;
  /** Nutrition per 100 g. */
  per100g: Nutrition;
  similarity: number;
}

/**
 * Normalize a nutrient to this app's canonical unit: grams for macros,
 * kcal for energy, MILLIGRAMS for sodium.
 *
 * USDA returns sodium in mg and macros in g today, but it also returns energy in
 * kJ for some rows and micrograms for some minerals. Converting explicitly means
 * a unit change upstream cannot silently corrupt stored nutrition.
 */
function toCanonicalUnit(key: keyof typeof NUTRIENT, n: FdcNutrient): number {
  const unit = n.unitName.toLowerCase();
  const v = n.value;

  if (key === "kcal") {
    if (unit === "kj") return v / 4.184;
    return v; // kcal
  }
  if (key === "sodium") {
    if (unit === "g") return v * 1000;
    if (unit === "µg" || unit === "ug" || unit === "mcg") return v / 1000;
    return v; // mg
  }
  // Macros: grams.
  if (unit === "mg") return v / 1000;
  if (unit === "µg" || unit === "ug" || unit === "mcg") return v / 1e6;
  return v; // g
}

function extractPer100g(food: FdcFood): Nutrition | null {
  const byId = new Map(food.foodNutrients.map((n) => [n.nutrientId, n]));

  const kcalRaw = byId.get(NUTRIENT.kcal);
  // Without energy there is nothing worth grounding against.
  if (!kcalRaw) return null;

  const read = (key: keyof typeof NUTRIENT): number => {
    const n = byId.get(NUTRIENT[key]);
    return n ? toCanonicalUnit(key, n) : 0;
  };

  return {
    kcal: read("kcal"),
    protein: read("protein"),
    carbs: read("carbs"),
    fat: read("fat"),
    fiber: read("fiber"),
    sugar: read("sugar"),
    sodium: read("sodium"),
  };
}

/**
 * Search USDA and return the best match above the similarity threshold, or null.
 *
 * Returning null is a normal outcome, not an error: it means "keep the model's
 * estimate", which is the correct answer for restaurant dishes and anything
 * USDA does not carry.
 */
export async function searchUsda(
  query: string,
  options: { signal?: AbortSignal; includeBranded?: boolean } = {},
): Promise<UsdaMatch | null> {
  if (query.trim() === "") return null;

  const qs = queryString({
    api_key: env.usdaApiKey(),
    query,
    pageSize: "5",
    dataType: options.includeBranded
      ? `${PREFERRED_TYPES},Branded`
      : PREFERRED_TYPES,
  });

  const res = await fetchWithRetry(`${BASE}/foods/search?${qs}`, options.signal);
  const data = (await res.json()) as { foods?: FdcFood[] };
  const foods = data.foods ?? [];

  let best: UsdaMatch | null = null;
  for (const food of foods) {
    const per100g = extractPer100g(food);
    if (!per100g) continue;

    const similarity = nameSimilarity(query, food.description);
    if (best === null || similarity > best.similarity) {
      best = {
        fdcId: String(food.fdcId),
        description: food.description,
        dataType: food.dataType ?? "unknown",
        per100g,
        similarity,
      };
    }
  }

  if (best === null || best.similarity < MATCH_THRESHOLD) return null;
  return best;
}

/** Look up a packaged product by barcode (UPC/EAN) in USDA's Branded set. */
export async function searchUsdaByBarcode(
  barcode: string,
  options: { signal?: AbortSignal } = {},
): Promise<UsdaMatch | null> {
  const qs = queryString({
    api_key: env.usdaApiKey(),
    query: barcode,
    pageSize: "1",
    dataType: "Branded",
  });

  const res = await fetchWithRetry(`${BASE}/foods/search?${qs}`, options.signal);
  const data = (await res.json()) as { foods?: FdcFood[] };
  const food = data.foods?.[0];
  if (!food) return null;

  const per100g = extractPer100g(food);
  if (!per100g) return null;

  return {
    fdcId: String(food.fdcId),
    description: food.description,
    dataType: food.dataType ?? "Branded",
    per100g,
    // A barcode is an exact identifier, so there is nothing to score.
    similarity: 1,
  };
}
