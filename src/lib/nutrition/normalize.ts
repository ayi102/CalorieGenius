/**
 * Canonicalization used by both caches.
 *
 * `normalizeFoodName` is the FoodItem lookup key, so its behaviour decides
 * whether "Greek yogurt, plain" and "plain greek yogurt" are one library entry
 * or two. Sorting tokens makes word order irrelevant; that is the point.
 *
 * Pure and dependency-free so the assertion scripts can import it.
 */

import { createHash } from "node:crypto";

/** Words that carry no identifying information for a food. */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "with", "and", "some", "my", "your",
  "fresh", "homemade", "plain", "regular",
]);

/** Combining diacritical marks, stripped after NFKD so "jalapeno" matches. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Lowercase, strip punctuation and stopwords, sort the remaining tokens.
 *
 * Sorting is deliberate: it collapses word-order variants onto one key. The
 * tradeoff is that genuinely different foods sharing a word set would collide,
 * which in practice does not happen for food names.
 */
export function normalizeFoodName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));

  // If stopword removal emptied it, fall back to the raw characters rather than
  // returning "" and collapsing every such food onto one row.
  if (tokens.length === 0) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  return tokens.sort().join(" ");
}

/**
 * Cache key for a raw entry sentence.
 *
 * Whitespace and case are normalized so trivial differences hit the same cache
 * row, but word order is NOT sorted here — unlike food names, order can change
 * meaning in a sentence, and a false cache hit would return the wrong meal.
 *
 * The model is part of the key so switching models invalidates naturally
 * instead of serving results the current model would not have produced.
 */
export function hashEntryText(text: string, model: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`${model} ${normalized}`).digest("hex");
}

/** Scale a per-100g nutrient to an arbitrary gram weight. */
export function scaleFrom100g(per100g: number, grams: number): number {
  return (per100g * grams) / 100;
}

/** Convert a portion nutrient back to a per-100g basis, for FoodItem storage. */
export function to100gBasis(forPortion: number, grams: number): number {
  if (grams <= 0) return 0;
  return (forPortion * 100) / grams;
}

/**
 * Token-overlap similarity in [0,1], used to decide whether a USDA hit is
 * actually the food we asked for.
 *
 * A cheap Jaccard-style measure is the right tool here: USDA descriptions are
 * comma-separated keyword lists, not prose, so token overlap tracks relevance
 * well and needs no dependency.
 */
export function nameSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeFoodName(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeFoodName(b).split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;

  // Divide by the smaller set so a long USDA description ("Egg, whole, cooked,
  // scrambled, with milk, in margarine") is not punished for being specific.
  return shared / Math.min(setA.size, setB.size);
}
