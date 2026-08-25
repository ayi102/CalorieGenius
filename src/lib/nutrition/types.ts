/**
 * The contract between the parser and everything downstream.
 *
 * This Zod schema is handed to the model via `zodOutputFormat`, so it is
 * simultaneously the validation and the specification — a field renamed here
 * changes what the model is asked to produce. Field descriptions are part of the
 * prompt in practice; keep them precise.
 */

import { z } from "zod";

/** Coarse taxonomy powering the month view's food-type breakdown. */
export const FOOD_GROUPS = [
  "protein",
  "grain",
  "vegetable",
  "fruit",
  "dairy",
  "fat",
  "sweet",
  "beverage",
  "mixed_dish",
  "alcohol",
] as const;

export const NutritionSchema = z.object({
  kcal: z.number().describe("Calories for the whole portion described by `grams`."),
  protein: z.number().describe("Grams of protein for the whole portion."),
  carbs: z.number().describe("Grams of carbohydrate for the whole portion."),
  fat: z.number().describe("Grams of fat for the whole portion."),
  fiber: z.number().describe("Grams of fiber for the whole portion. 0 if none."),
  sugar: z.number().describe("Grams of total sugars for the whole portion. 0 if none."),
  sodium: z.number().describe("MILLIGRAMS of sodium for the whole portion. 0 if none."),
});

export const ParsedItemSchema = z.object({
  name: z
    .string()
    .describe(
      "Short canonical food name, singular, no quantity. 'scrambled eggs', not '2 scrambled eggs'.",
    ),
  brand: z
    .string()
    .nullable()
    .describe("Manufacturer if the user named one (e.g. 'Chobani'), else null."),
  quantity: z
    .number()
    .describe("How many units the user ate, e.g. 2 for 'two eggs'. Default 1."),
  unit: z
    .string()
    .describe("Unit for `quantity`: 'egg', 'slice', 'cup', 'oz', 'serving', etc."),
  grams: z
    .number()
    .describe(
      "TOTAL weight in grams for the ENTIRE quantity, not per unit. Two 50g eggs => 100. This is what all nutrition below is for.",
    ),
  foodGroup: z.enum(FOOD_GROUPS).describe("Best-fit group for this item."),
  processedLevel: z
    .number()
    .int()
    .min(1)
    .max(4)
    .describe(
      "NOVA-style: 1 unprocessed/whole, 2 processed culinary ingredient, 3 processed food, 4 ultra-processed.",
    ),
  usdaSearchQuery: z
    .string()
    .describe(
      "A clean USDA FoodData Central search phrase for this item's core food, in USDA's own style (e.g. 'Egg, whole, cooked, scrambled'). Empty string for restaurant-specific dishes that USDA will not have.",
    ),
  estimatedNutrition: NutritionSchema.describe(
    "Your best estimate for the whole portion. Used directly when no database match is found.",
  ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How confident you are in the portion size and nutrition. Below 0.5 is surfaced to the user as a guess.",
    ),
});

export const ParsedMealSchema = z.object({
  mealName: z
    .string()
    .describe(
      'A short human name for this meal, 2-4 words, Title Case — how they would refer to it out loud. "Homemade Coffee", "Greek Yogurt Bowl", "Chicken And Rice", "Salmon Dinner". Never a comma-separated ingredient list, and never longer than about 30 characters.',
    ),
  items: z.array(ParsedItemSchema).describe("One entry per distinct food or drink."),
  restaurantName: z
    .string()
    .nullable()
    .describe("Restaurant or chain if this was eaten out, else null."),
  /** Lets the parser flag input that isn't food at all. */
  isFood: z
    .boolean()
    .describe("False if the text does not describe anything eaten or drunk."),
  note: z
    .string()
    .describe(
      "One short sentence for the user about assumptions you made, or empty string. e.g. 'Assumed a medium portion.'",
    ),
});

export type ParsedItem = z.infer<typeof ParsedItemSchema>;
export type ParsedMeal = z.infer<typeof ParsedMealSchema>;
export type Nutrition = z.infer<typeof NutritionSchema>;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

/** Context handed to a parser provider alongside the raw text. */
export interface ParseContext {
  /** Present when the user logged via the restaurant flow. */
  restaurantName?: string | null;
  /** Base64 image for the photo flow. */
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp";
}

export interface ParseResult {
  meal: ParsedMeal;
  /** For the usage meter and the cost estimate. */
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  model: string;
  /** True when this came from ParseCache and cost nothing. */
  cached: boolean;
}

/** A provider turns text (or an image) into a ParsedMeal. */
export interface ParserProvider {
  readonly name: string;
  parse(text: string, context: ParseContext): Promise<ParseResult>;
}
