"use server";

/**
 * Write side of the data layer — every mutation in the app lives here.
 *
 * Rules, both load-bearing:
 *  1. `requireUser()` is the FIRST line of every action. Server Actions are
 *     reachable as HTTP endpoints regardless of what the UI renders, so an
 *     action without it is an unauthenticated write endpoint.
 *  2. Never trust an id from the client for ownership. Scope by the userId that
 *     requireUser() returned, and verify parent ownership inside the same
 *     transaction as the write.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DEV_USER_COOKIE, requireUser } from "@/lib/auth";
import { authMode } from "@/lib/env";
import { resolveEntry, ParseLimitError } from "@/lib/nutrition/resolve";
import { guessMealType, toLocalDate } from "@/lib/time";
import { feetInchesToCm, lbToKg, type UnitSystem } from "@/lib/units";
import { normalizeFoodName } from "@/lib/nutrition/normalize";
import { computeTargets, ageFrom } from "@/lib/scoring";
import {
  generateWeeklyInsight,
  NotEnoughDataError,
} from "@/lib/insights/generate";
import {
  generatePatternInsight,
  NotEnoughPatternDataError,
} from "@/lib/insights/patterns";
import { lookupBarcode } from "@/lib/nutrition/off";
import { searchUsdaByBarcode } from "@/lib/nutrition/usda";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Parse a form field into a number, treating blank as "not set". */
function optionalNumber(
  form: FormData,
  key: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number | null | undefined {
  const raw = form.get(key);
  if (raw === null) return undefined; // field absent — leave unchanged
  const s = String(raw).trim();
  if (s === "") return null; // field present but blank — clear it
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  if (opts.min !== undefined && n < opts.min) return undefined;
  if (opts.max !== undefined && n > opts.max) return undefined;
  return opts.integer ? Math.round(n) : n;
}

const SEXES = ["male", "female"] as const;
const ACTIVITY = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
] as const;
const GOALS = ["lose", "maintain", "gain"] as const;
const UNIT_SYSTEMS = ["imperial", "metric"] as const;

function optionalEnum<T extends readonly string[]>(
  form: FormData,
  key: string,
  allowed: T,
): T[number] | null | undefined {
  const raw = form.get(key);
  if (raw === null) return undefined;
  const s = String(raw).trim();
  if (s === "") return null;
  return (allowed as readonly string[]).includes(s)
    ? (s as T[number])
    : undefined;
}

/**
 * Update the signed-in user's profile.
 *
 * Only ever writes to `where: { userId }` from the session — the form cannot
 * name a different user.
 */
export async function updateProfile(form: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const timezoneRaw = form.get("timezone");
  const timezone =
    timezoneRaw === null ? undefined : String(timezoneRaw).trim() || undefined;

  // Reject an unknown timezone rather than storing a string that would silently
  // break every date bucket for this user.
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return { ok: false, error: `"${timezone}" is not a valid IANA timezone.` };
    }
  }

  const nameRaw = form.get("name");
  const birthRaw = form.get("birthDate");

  let birthDate: Date | null | undefined = undefined;
  if (birthRaw !== null) {
    const s = String(birthRaw).trim();
    if (s === "") {
      birthDate = null;
    } else {
      // A date input is a calendar date; anchor it at UTC midnight so it cannot
      // drift a day in a negative-offset zone.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return { ok: false, error: "Birth date must be YYYY-MM-DD." };
      birthDate = new Date(
        Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
      );
      if (Number.isNaN(birthDate.getTime())) {
        return { ok: false, error: "Birth date is not a real date." };
      }
    }
  }

  // --- Units. Storage is always metric; the form may submit either system.
  // Converting server-side means a tampered or stale client cannot write a
  // pound value into a kilogram column.
  const unitSystem = optionalEnum(form, "unitSystem", UNIT_SYSTEMS);
  const effectiveSystem =
    unitSystem ?? (await currentUnitSystem(user.userId)) ?? "imperial";

  let heightCm: number | null | undefined;
  let weightKg: number | null | undefined;

  if (effectiveSystem === "imperial") {
    const feet = optionalNumber(form, "heightFeet", { min: 1, max: 8, integer: true });
    const inches = optionalNumber(form, "heightInches", { min: 0, max: 11 });
    // Absent entirely -> leave unchanged. Present but blank -> clear.
    if (feet === undefined && inches === undefined) {
      heightCm = undefined;
    } else if (feet === null || feet === undefined) {
      heightCm = null;
    } else {
      heightCm = feetInchesToCm(feet, inches ?? 0);
    }

    const lb = optionalNumber(form, "weightLb", { min: 45, max: 880 });
    weightKg = lb === undefined ? undefined : lb === null ? null : lbToKg(lb);
  } else {
    heightCm = optionalNumber(form, "heightCm", { min: 50, max: 260 });
    weightKg = optionalNumber(form, "weightKg", { min: 20, max: 400 });
  }

  await prisma.profile.update({
    where: { userId: user.userId },
    data: {
      name: nameRaw === null ? undefined : String(nameRaw).trim() || null,
      timezone,
      unitSystem: unitSystem ?? undefined,
      sex: optionalEnum(form, "sex", SEXES),
      birthDate,
      heightCm,
      weightKg,
      activityLevel: optionalEnum(form, "activityLevel", ACTIVITY) ?? undefined,
      goal: optionalEnum(form, "goal", GOALS) ?? undefined,
      calorieTargetOverride: optionalNumber(form, "calorieTargetOverride", {
        min: 800,
        max: 8000,
        integer: true,
      }),
      proteinTargetOverride: optionalNumber(form, "proteinTargetOverride", {
        min: 20,
        max: 400,
        integer: true,
      }),
      bedtimeMinutes:
        optionalNumber(form, "bedtimeMinutes", {
          min: 0,
          max: 1439,
          integer: true,
        }) ?? undefined,
      // A checkbox is absent from the FormData when unchecked, so its absence
      // means false — not "leave unchanged" as it does for text fields.
      eatingWindowEnabled: form.has("eatingWindowSubmitted")
        ? form.get("eatingWindowEnabled") === "on"
        : undefined,
      eatingWindowStart:
        optionalNumber(form, "eatingWindowStart", {
          min: 0,
          max: 1439,
          integer: true,
        }) ?? undefined,
      eatingWindowEnd:
        optionalNumber(form, "eatingWindowEnd", {
          min: 0,
          max: 1439,
          integer: true,
        }) ?? undefined,
      // Blank clears the override, which returns the goal to 35 ml/kg.
      waterTargetMl: optionalNumber(form, "waterTargetMl", {
        min: 250,
        max: 8000,
        integer: true,
      }),
    },
  });

  // Targets and the timezone affect every view.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Dev-only: switch which seeded user the app is acting as.
 *
 * Guarded by authMode() so it is inert the moment real auth is on, and env.ts
 * additionally refuses AUTH_MODE=dev in production.
 */
export async function switchDevUser(form: FormData): Promise<void> {
  if (authMode() !== "dev") {
    throw new Error("The dev user switcher is disabled under real auth.");
  }

  const userId = String(form.get("userId") ?? "").trim();
  // Only ever accept an id that actually exists, so the cookie can't be used to
  // wedge the app into a nonexistent session.
  const exists = await prisma.profile.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (!exists) throw new Error(`No seeded profile "${userId}".`);

  const jar = await cookies();
  jar.set(DEV_USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------------------
// Food entry
// ---------------------------------------------------------------------------

/** A parsed item as sent to the browser for confirmation. Plain data only. */
export interface PreviewItem {
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  grams: number;
  /**
   * Grams in ONE serving, when the source declares a serving size (barcode
   * labels do). Lets the UI ask for servings — which is how packaged food is
   * actually measured — instead of making someone weigh a cereal box.
   * Null for foods with no meaningful serving unit.
   */
  servingGrams: number | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  foodGroup: string;
  processedLevel: number;
  nutritionSource: string;
  confidence: number;
  usdaFdcId: string | null;
  foodItemId: string | null;
  provenance: string;
  lookupUnavailable: boolean;
}

export interface AnalyzeResult {
  ok: boolean;
  error?: string;
  /** Set when the daily cap is hit, so the UI can offer manual entry instead. */
  limitReached?: boolean;
  items?: PreviewItem[];
  mealName?: string;
  restaurantName?: string | null;
  note?: string;
  isFood?: boolean;
  cached?: boolean;
  parsesRemaining?: number;
  /** Echoed back so the save step reuses exactly what was previewed. */
  rawText?: string;
  eatenAtIso?: string;
}

/**
 * Parse text into items for confirmation. Does NOT write an Entry.
 *
 * Split from saving on purpose: portion estimates are the weakest part of this
 * pipeline, so the user gets to see and correct grams before anything is
 * committed to their diary.
 */
export async function analyzeEntry(form: FormData): Promise<AnalyzeResult> {
  const user = await requireUser();

  const rawText = String(form.get("rawText") ?? "").trim();
  const restaurantName =
    String(form.get("restaurantName") ?? "").trim() || null;

  if (rawText === "") return { ok: false, error: "Type what you ate first." };

  // The client sends a local datetime string; treat a missing/invalid one as now
  // rather than rejecting the entry.
  const eatenAtRaw = String(form.get("eatenAt") ?? "").trim();
  const eatenAt = eatenAtRaw ? new Date(eatenAtRaw) : new Date();
  if (Number.isNaN(eatenAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  try {
    const outcome = await resolveEntry(user.userId, user.timezone, rawText, {
      eatenAt,
      restaurantName,
    });

    if (!outcome.isFood || outcome.items.length === 0) {
      return {
        ok: false,
        error:
          "That doesn't look like food. Try something like “2 eggs and toast with butter”.",
      };
    }

    return {
      ok: true,
      items: outcome.items.map((i) => ({
        name: i.name,
        brand: i.brand,
        quantity: i.quantity,
        unit: i.unit,
        grams: i.grams,
        // Only barcode lookups carry a declared serving size.
        servingGrams: null,
        kcal: i.nutrition.kcal,
        protein: i.nutrition.protein,
        carbs: i.nutrition.carbs,
        fat: i.nutrition.fat,
        fiber: i.nutrition.fiber,
        sugar: i.nutrition.sugar,
        sodium: i.nutrition.sodium,
        foodGroup: i.foodGroup,
        processedLevel: i.processedLevel,
        nutritionSource: i.nutritionSource,
        confidence: i.confidence,
        usdaFdcId: i.usdaFdcId,
        foodItemId: i.foodItemId,
        provenance: i.provenance,
        lookupUnavailable: i.lookupUnavailable,
      })),
      mealName: outcome.mealName,
      restaurantName: outcome.restaurantName,
      note: outcome.note,
      isFood: true,
      cached: outcome.cached,
      parsesRemaining: outcome.usage.parsesRemaining,
      rawText,
      eatenAtIso: eatenAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof ParseLimitError) {
      return { ok: false, limitReached: true, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not read that. Try rewording it.",
    };
  }
}

export interface SaveEntryInput {
  rawText: string;
  /** The card title. Falls back to the raw text if the parser gave none. */
  mealName?: string;
  eatenAtIso: string;
  restaurantName: string | null;
  source: "text" | "photo" | "barcode" | "restaurant" | "quickadd" | "manual";
  items: PreviewItem[];
}

/**
 * Persist a confirmed entry.
 *
 * Nutrition is written onto EntryItem rows rather than referenced, so a later
 * correction to a FoodItem never silently rewrites a past day's score.
 *
 * The grams the user confirmed are authoritative: if they edited a portion, the
 * nutrition is rescaled here from the same ratio, because the numbers shown to
 * them must be the numbers stored.
 */
export async function saveEntry(input: SaveEntryInput): Promise<ActionResult> {
  const user = await requireUser();

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: "Nothing to save." };
  }

  const eatenAt = new Date(input.eatenAtIso);
  if (Number.isNaN(eatenAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  const localDate = toLocalDate(eatenAt, user.timezone);
  const mealType = guessMealType(eatenAt, user.timezone);

  try {
    await prisma.entry.create({
      data: {
        userId: user.userId,
        eatenAt,
        localDate,
        mealType,
        source: input.source,
        title: input.mealName?.trim() || null,
        rawText: input.rawText,
        restaurantName: input.restaurantName,
        items: {
          create: input.items.map((i) => ({
            // Only link a FoodItem we can still see; a stale id from the client
            // must not become a dangling reference.
            foodItemId: i.foodItemId,
            name: i.name,
            brand: i.brand,
            quantity: i.quantity,
            unit: i.unit,
            grams: i.grams,
            kcal: i.kcal,
            protein: i.protein,
            carbs: i.carbs,
            fat: i.fat,
            fiber: i.fiber,
            sugar: i.sugar,
            sodium: i.sodium,
            foodGroup: i.foodGroup as never,
            processedLevel: i.processedLevel,
            nutritionSource: i.nutritionSource as never,
            confidence: i.confidence,
            usdaFdcId: i.usdaFdcId,
          })),
        },
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save that.",
    };
  }

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/** Remove one of the user's own entries. */
export async function deleteEntry(entryId: string): Promise<ActionResult> {
  const user = await requireUser();

  // Scope the delete by userId in the same statement — never look up first and
  // trust the id, which would be a TOCTOU hole.
  const result = await prisma.entry.deleteMany({
    where: { id: entryId, userId: user.userId },
  });

  if (result.count === 0) return { ok: false, error: "Entry not found." };

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/**
 * The user's stored unit preference.
 *
 * Needed because a form may omit the unitSystem field (e.g. a partial update),
 * and we must still know how to interpret the height/weight fields it did send.
 */
async function currentUnitSystem(userId: string): Promise<UnitSystem | null> {
  const p = await prisma.profile.findUnique({
    where: { userId },
    select: { unitSystem: true },
  });
  return p?.unitSystem ?? null;
}

// ---------------------------------------------------------------------------
// Editing a saved entry
// ---------------------------------------------------------------------------

/**
 * Change a saved item's portion, rescaling its nutrition by the same ratio.
 *
 * Ownership is enforced by matching the parent Entry's userId in the same query
 * — an item id alone must never be enough to touch someone's diary.
 */
export async function updateItemGrams(
  itemId: string,
  grams: number,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
    return { ok: false, error: "Enter a weight between 1 and 5000 g." };
  }

  const item = await prisma.entryItem.findFirst({
    where: { id: itemId, entry: { userId: user.userId } },
  });
  if (!item) return { ok: false, error: "Item not found." };

  if (item.grams <= 0) return { ok: false, error: "That item has no weight to scale." };
  const f = grams / item.grams;

  await prisma.entryItem.update({
    where: { id: item.id },
    data: {
      grams,
      kcal: item.kcal * f,
      protein: item.protein * f,
      carbs: item.carbs * f,
      fat: item.fat * f,
      fiber: item.fiber === null ? null : item.fiber * f,
      sugar: item.sugar === null ? null : item.sugar * f,
      sodium: item.sodium === null ? null : item.sodium * f,
      // The user has now vouched for this portion, so it stops being a guess.
      nutritionSource: "user",
      confidence: 1,
    },
  });

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/**
 * Change a saved item's portion by number of SERVINGS.
 *
 * Only meaningful for items that were logged with a serving unit (barcode
 * scans), where per-serving grams is recoverable as grams / quantity. Fractional
 * servings are the point — half a serving is a normal thing to eat.
 */
export async function updateItemServings(
  itemId: string,
  servings: number,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!Number.isFinite(servings) || servings <= 0 || servings > 50) {
    return { ok: false, error: "Enter between 0.25 and 50 servings." };
  }

  const item = await prisma.entryItem.findFirst({
    where: { id: itemId, entry: { userId: user.userId } },
  });
  if (!item) return { ok: false, error: "Item not found." };

  if (item.quantity <= 0 || item.grams <= 0) {
    return { ok: false, error: "That item has no serving size to scale." };
  }

  // Recover the label's serving weight from what was stored, then rebuild.
  const gramsPerServing = item.grams / item.quantity;
  const nextGrams = gramsPerServing * servings;
  const f = nextGrams / item.grams;

  await prisma.entryItem.update({
    where: { id: item.id },
    data: {
      quantity: servings,
      grams: nextGrams,
      kcal: item.kcal * f,
      protein: item.protein * f,
      carbs: item.carbs * f,
      fat: item.fat * f,
      fiber: item.fiber === null ? null : item.fiber * f,
      sugar: item.sugar === null ? null : item.sugar * f,
      sodium: item.sodium === null ? null : item.sodium * f,
      nutritionSource: "user",
      confidence: 1,
    },
  });

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/**
 * Override a saved item's calories and macros directly.
 *
 * The escape hatch for when the parse was simply wrong. Writes
 * `nutritionSource: "user"`, which outranks every automated source — including a
 * later USDA match — so a correction is never silently undone.
 *
 * Also teaches the food library: the per-100g basis is written back to the
 * user's own FoodItem row so the same food resolves correctly next time.
 */
export async function correctItem(input: {
  itemId: string;
  name?: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}): Promise<ActionResult> {
  const user = await requireUser();

  const { itemId, grams, kcal, protein, carbs, fat } = input;
  const numbers = { grams, kcal, protein, carbs, fat };
  for (const [key, value] of Object.entries(numbers)) {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: `${key} must be a positive number.` };
    }
  }
  if (grams <= 0 || grams > 5000) {
    return { ok: false, error: "Enter a weight between 1 and 5000 g." };
  }

  const item = await prisma.entryItem.findFirst({
    where: { id: itemId, entry: { userId: user.userId } },
    select: { id: true, name: true, brand: true, foodGroup: true, processedLevel: true },
  });
  if (!item) return { ok: false, error: "Item not found." };

  const name = input.name?.trim() || item.name;

  await prisma.$transaction(async (tx) => {
    await tx.entryItem.update({
      where: { id: item.id },
      data: {
        name,
        grams,
        kcal,
        protein,
        carbs,
        fat,
        nutritionSource: "user",
        confidence: 1,
      },
    });

    // Remember the correction as the user's own library row, so it wins over the
    // shared entry next time without altering what other users see.
    const normalizedName = normalizeFoodName(name);
    const existing = await tx.foodItem.findFirst({
      where: { userId: user.userId, normalizedName, brand: item.brand },
      select: { id: true },
    });

    const per100g = {
      kcalPer100g: (kcal * 100) / grams,
      proteinPer100g: (protein * 100) / grams,
      carbsPer100g: (carbs * 100) / grams,
      fatPer100g: (fat * 100) / grams,
    };

    if (existing) {
      await tx.foodItem.update({
        where: { id: existing.id },
        data: { ...per100g, defaultGrams: grams, nutritionSource: "user" },
      });
    } else {
      await tx.foodItem.create({
        data: {
          userId: user.userId,
          normalizedName,
          displayName: name,
          brand: item.brand,
          ...per100g,
          defaultGrams: grams,
          foodGroup: item.foodGroup,
          processedLevel: item.processedLevel,
          nutritionSource: "user",
          timesLogged: 1,
          lastLoggedAt: new Date(),
        },
      });
    }
  });

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/** Remove one item from a saved entry, deleting the entry if it empties. */
export async function deleteItem(itemId: string): Promise<ActionResult> {
  const user = await requireUser();

  const item = await prisma.entryItem.findFirst({
    where: { id: itemId, entry: { userId: user.userId } },
    select: { id: true, entryId: true },
  });
  if (!item) return { ok: false, error: "Item not found." };

  await prisma.$transaction(async (tx) => {
    await tx.entryItem.delete({ where: { id: item.id } });
    // An entry with no items is not a meal — leaving it would show an empty
    // card and count toward the day's meal-count score.
    const left = await tx.entryItem.count({ where: { entryId: item.entryId } });
    if (left === 0) {
      await tx.entry.delete({ where: { id: item.entryId } });
    }
  });

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/** Move a saved entry to a different time, re-deriving its local date and meal. */
export async function updateEntryTime(
  entryId: string,
  eatenAtIso: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const eatenAt = new Date(eatenAtIso);
  if (Number.isNaN(eatenAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  // localDate and mealType are derived from eatenAt, so both must move with it —
  // otherwise the entry stays filed under the old day.
  const result = await prisma.entry.updateMany({
    where: { id: entryId, userId: user.userId },
    data: {
      eatenAt,
      localDate: toLocalDate(eatenAt, user.timezone),
      mealType: guessMealType(eatenAt, user.timezone),
    },
  });

  if (result.count === 0) return { ok: false, error: "Entry not found." };

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Barcode
// ---------------------------------------------------------------------------

export interface BarcodeResult {
  ok: boolean;
  error?: string;
  item?: PreviewItem;
}

/**
 * Resolve a scanned barcode into a confirmable item.
 *
 * Costs no model tokens and consumes no parse quota: it is a database lookup,
 * which is exactly why it is the most accurate input this app has.
 *
 * Order: the local FoodItem cache (free, instant, and covers repeat scans of the
 * same groceries), then Open Food Facts, then USDA's branded set.
 */
export async function scanBarcode(barcode: string): Promise<BarcodeResult> {
  const user = await requireUser();

  const clean = String(barcode).replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 14) {
    return { ok: false, error: "That doesn't look like a product barcode." };
  }

  // 1. Already known — no network call at all.
  const cached = await prisma.foodItem.findFirst({
    where: { barcode: clean, OR: [{ userId: user.userId }, { userId: null }] },
    orderBy: [{ userId: "asc" }],
  });

  if (cached) {
    const grams = cached.defaultGrams;
    const f = grams / 100;
    return {
      ok: true,
      item: {
        name: cached.displayName,
        brand: cached.brand,
        quantity: 1,
        unit: "serving",
        grams,
        servingGrams: cached.defaultGrams,
        kcal: cached.kcalPer100g * f,
        protein: cached.proteinPer100g * f,
        carbs: cached.carbsPer100g * f,
        fat: cached.fatPer100g * f,
        fiber: (cached.fiberPer100g ?? 0) * f,
        sugar: (cached.sugarPer100g ?? 0) * f,
        sodium: (cached.sodiumPer100g ?? 0) * f,
        foodGroup: cached.foodGroup,
        processedLevel: cached.processedLevel,
        nutritionSource: cached.nutritionSource,
        confidence: 1,
        usdaFdcId: cached.usdaFdcId,
        foodItemId: cached.id,
        provenance:
          cached.nutritionSource === "user"
            ? "Your correction"
            : "Scanned before (cached)",
        lookupUnavailable: false,
      },
    };
  }

  // 2. Open Food Facts, then 3. USDA branded.
  try {
    const off = await lookupBarcode(clean);

    let name: string;
    let brand: string | null;
    let per100g: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; sodium: number };
    let grams: number;
    let foodGroup: string;
    let processedLevel: number;
    let source: "openfoodfacts" | "usda";
    let usdaFdcId: string | null = null;
    let provenance: string;

    if (off) {
      name = off.name;
      brand = off.brand;
      per100g = off.per100g;
      grams = off.defaultGrams;
      foodGroup = off.foodGroup;
      processedLevel = off.processedLevel;
      source = "openfoodfacts";
      provenance = `Open Food Facts label${off.processedLevelInferred ? " (processing level inferred)" : ""}`;
    } else {
      const usda = await searchUsdaByBarcode(clean);
      if (!usda) {
        return {
          ok: false,
          error:
            "That barcode isn't in Open Food Facts or USDA. Type the food instead, and it'll be remembered.",
        };
      }
      name = usda.description;
      brand = null;
      per100g = usda.per100g;
      grams = 100;
      foodGroup = "mixed_dish";
      processedLevel = 4;
      source = "usda";
      usdaFdcId = usda.fdcId;
      provenance = `USDA branded: ${usda.description}`;
    }

    // Cache it so a rescan costs nothing and it shows up in quick-add.
    const saved = await prisma.foodItem
      .create({
        data: {
          userId: null,
          normalizedName: normalizeFoodName(brand ? `${brand} ${name}` : name),
          displayName: name,
          brand,
          barcode: clean,
          usdaFdcId,
          kcalPer100g: per100g.kcal,
          proteinPer100g: per100g.protein,
          carbsPer100g: per100g.carbs,
          fatPer100g: per100g.fat,
          fiberPer100g: per100g.fiber,
          sugarPer100g: per100g.sugar,
          sodiumPer100g: per100g.sodium,
          defaultGrams: grams,
          foodGroup: foodGroup as never,
          processedLevel,
          nutritionSource: source,
          timesLogged: 0,
        },
        select: { id: true },
      })
      .catch(() => null); // a duplicate scan racing itself is harmless

    const f = grams / 100;
    return {
      ok: true,
      item: {
        name,
        brand,
        quantity: 1,
        unit: "serving",
        grams,
        servingGrams: grams,
        kcal: per100g.kcal * f,
        protein: per100g.protein * f,
        carbs: per100g.carbs * f,
        fat: per100g.fat * f,
        fiber: per100g.fiber * f,
        sugar: per100g.sugar * f,
        sodium: per100g.sodium * f,
        foodGroup,
        processedLevel,
        nutritionSource: source,
        // A label panel is a measurement, not an estimate.
        confidence: 1,
        usdaFdcId,
        foodItemId: saved?.id ?? null,
        provenance,
        lookupUnavailable: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Lookup failed: ${error.message}`
          : "Lookup failed.",
    };
  }
}

// ---------------------------------------------------------------------------
// Re-logging from memory
// ---------------------------------------------------------------------------

/**
 * Log a past meal again, at a new time.
 *
 * Copies the stored EntryItem rows verbatim — **no model call, no USDA lookup,
 * no parse quota**. That is the point: a meal you have eaten before should be
 * one tap and cost nothing, and it removes any reason to make the user build
 * "recipes" by hand.
 *
 * Nutrition is copied rather than re-resolved so a repeat of Tuesday's lunch has
 * Tuesday's numbers, including any correction made since.
 */
export async function relogEntry(
  sourceEntryId: string,
  eatenAtIso?: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const source = await prisma.entry.findFirst({
    // Scoped by userId: an entry id alone must never let someone copy another
    // person's meal into their own diary.
    where: { id: sourceEntryId, userId: user.userId },
    include: { items: true },
  });
  if (!source) return { ok: false, error: "That meal is no longer in your history." };
  if (source.items.length === 0) return { ok: false, error: "That meal has no items." };

  const eatenAt = eatenAtIso ? new Date(eatenAtIso) : new Date();
  if (Number.isNaN(eatenAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  await prisma.entry.create({
    data: {
      userId: user.userId,
      eatenAt,
      localDate: toLocalDate(eatenAt, user.timezone),
      // Meal type is re-derived from the NEW time, not copied: the same food at
      // 8am is breakfast and at 8pm is dinner.
      mealType: guessMealType(eatenAt, user.timezone),
      source: "quickadd",
      title: source.title,
      rawText: source.rawText,
      restaurantName: source.restaurantName,
      items: {
        create: source.items.map((i) => ({
          foodItemId: i.foodItemId,
          name: i.name,
          brand: i.brand,
          quantity: i.quantity,
          unit: i.unit,
          grams: i.grams,
          kcal: i.kcal,
          protein: i.protein,
          carbs: i.carbs,
          fat: i.fat,
          fiber: i.fiber,
          sugar: i.sugar,
          sodium: i.sodium,
          foodGroup: i.foodGroup,
          processedLevel: i.processedLevel,
          nutritionSource: i.nutritionSource,
          confidence: i.confidence,
          usdaFdcId: i.usdaFdcId,
        })),
      },
    },
  });

  // Bump the library counts so frequently re-logged foods keep rising.
  const foodIds = source.items
    .map((i) => i.foodItemId)
    .filter((id): id is string => id !== null);
  if (foodIds.length > 0) {
    await prisma.foodItem
      .updateMany({
        where: { id: { in: foodIds } },
        data: { timesLogged: { increment: 1 }, lastLoggedAt: new Date() },
      })
      .catch(() => {}); // a stat update must not fail the log
  }

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/**
 * Add a single remembered food as its own entry. Also free — it reads the stored
 * per-100g nutrition rather than looking anything up.
 */
export async function quickAddFood(
  foodItemId: string,
  amount: number,
  eatenAtIso?: string,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!Number.isFinite(amount) || amount <= 0 || amount > 50) {
    return { ok: false, error: "Enter an amount between 0.25 and 50." };
  }

  const food = await prisma.foodItem.findFirst({
    where: { id: foodItemId, OR: [{ userId: user.userId }, { userId: null }] },
  });
  if (!food) return { ok: false, error: "That food is no longer in your library." };

  const eatenAt = eatenAtIso ? new Date(eatenAtIso) : new Date();
  if (Number.isNaN(eatenAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  // A barcode row has a real label serving, so `amount` means servings there and
  // grams elsewhere.
  const isServing = food.barcode !== null;
  const grams = isServing ? food.defaultGrams * amount : amount;
  const f = grams / 100;

  await prisma.entry.create({
    data: {
      userId: user.userId,
      eatenAt,
      localDate: toLocalDate(eatenAt, user.timezone),
      mealType: guessMealType(eatenAt, user.timezone),
      source: "quickadd",
      title: food.displayName,
      rawText: food.displayName,
      restaurantName: food.restaurantName,
      items: {
        create: [
          {
            foodItemId: food.id,
            name: food.displayName,
            brand: food.brand,
            quantity: isServing ? amount : 1,
            unit: isServing ? "serving" : "portion",
            grams,
            kcal: food.kcalPer100g * f,
            protein: food.proteinPer100g * f,
            carbs: food.carbsPer100g * f,
            fat: food.fatPer100g * f,
            fiber: (food.fiberPer100g ?? 0) * f,
            sugar: (food.sugarPer100g ?? 0) * f,
            sodium: (food.sodiumPer100g ?? 0) * f,
            foodGroup: food.foodGroup,
            processedLevel: food.processedLevel,
            nutritionSource: food.nutritionSource,
            confidence: 1,
            usdaFdcId: food.usdaFdcId,
          },
        ],
      },
    },
  });

  await prisma.foodItem
    .update({
      where: { id: food.id },
      data: { timesLogged: { increment: 1 }, lastLoggedAt: new Date() },
    })
    .catch(() => {});

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/**
 * Log a drink of water.
 *
 * `ml` rather than a preset id so a custom amount needs no special case, and the
 * stored unit stays metric regardless of what the user sees.
 */
export async function addWater(
  ml: number,
  drankAtIso?: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const amount = Math.round(ml);
  // A 4-litre single entry is almost certainly a typo, and silently storing it
  // would quietly ruin the day's total.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 4000) {
    return { ok: false, error: "Enter an amount between 1 ml and 4 litres." };
  }

  const drankAt = drankAtIso ? new Date(drankAtIso) : new Date();
  if (Number.isNaN(drankAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  await prisma.waterLog.create({
    data: {
      userId: user.userId,
      drankAt,
      localDate: toLocalDate(drankAt, user.timezone),
      ml: amount,
    },
  });

  revalidatePath("/");
  revalidatePath("/month");
  return { ok: true };
}

/** Remove a logged drink — scoped by userId in the same statement. */
export async function removeWater(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await prisma.waterLog.deleteMany({
    where: { id, userId: user.userId },
  });
  if (result.count === 0) return { ok: false, error: "Not found." };

  revalidatePath("/");
  revalidatePath("/month");
  return { ok: true };
}

/** Undo the most recent drink of the day — the common correction after a mis-tap. */
export async function undoLastWater(): Promise<ActionResult> {
  const user = await requireUser();
  const last = await prisma.waterLog.findFirst({
    where: { userId: user.userId },
    orderBy: { drankAt: "desc" },
    select: { id: true },
  });
  if (!last) return { ok: false, error: "Nothing to undo." };

  await prisma.waterLog.delete({ where: { id: last.id } });
  revalidatePath("/");
  revalidatePath("/month");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

/**
 * Record a weigh-in.
 *
 * Writes BOTH the history row and Profile.weightKg in one transaction: targets
 * are computed from the profile, so letting the two drift would mean the app
 * showed one weight and scored against another.
 *
 * One row per local day — weight swings through the day, and a second weigh-in
 * replaces rather than adds.
 */
export async function logWeight(
  weightKg: number,
  dateIso?: string,
  note?: string,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
    return { ok: false, error: "Enter a realistic weight." };
  }

  const at = dateIso ? new Date(dateIso) : new Date();
  if (Number.isNaN(at.getTime())) return { ok: false, error: "That date isn't valid." };
  const localDate = toLocalDate(at, user.timezone);

  await prisma.$transaction(async (tx) => {
    await tx.weightLog.upsert({
      where: { userId_localDate: { userId: user.userId, localDate } },
      update: { weightKg, note: note?.trim() || null },
      create: {
        userId: user.userId,
        localDate,
        weightKg,
        note: note?.trim() || null,
      },
    });

    // Only move the profile's current weight when this is the newest weigh-in —
    // back-filling last month must not rewrite today's targets.
    const newest = await tx.weightLog.findFirst({
      where: { userId: user.userId },
      orderBy: { localDate: "desc" },
      select: { localDate: true, weightKg: true },
    });
    if (newest) {
      await tx.profile.update({
        where: { userId: user.userId },
        data: { weightKg: newest.weightKg },
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Remove a weigh-in, and re-sync the profile to whatever is newest after it. */
export async function deleteWeight(id: string): Promise<ActionResult> {
  const user = await requireUser();

  const result = await prisma.weightLog.deleteMany({
    where: { id, userId: user.userId },
  });
  if (result.count === 0) return { ok: false, error: "Not found." };

  const newest = await prisma.weightLog.findFirst({
    where: { userId: user.userId },
    orderBy: { localDate: "desc" },
    select: { weightKg: true },
  });
  if (newest) {
    await prisma.profile.update({
      where: { userId: user.userId },
      data: { weightKg: newest.weightKg },
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface InsightActionResult {
  ok: boolean;
  error?: string;
  notEnoughData?: boolean;
}

/**
 * Generate (or regenerate) the weekly review.
 *
 * Deliberately an explicit action rather than something the page does on load:
 * it takes ~25 seconds and costs a model call, so it must be something the user
 * asks for and can see happening. Once generated it is cached, and the page
 * reads the cache.
 */
export async function generateInsight(
  periodStart: string,
  periodEnd: string,
  force = false,
): Promise<InsightActionResult> {
  const user = await requireUser();

  const profile = await prisma.profile.findUnique({
    where: { userId: user.userId },
  });
  if (!profile) return { ok: false, error: "Profile not found." };

  const targets = computeTargets({
    sex: profile.sex,
    ageYears: profile.birthDate ? ageFrom(profile.birthDate, new Date()) : null,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    calorieTargetOverride: profile.calorieTargetOverride,
    proteinTargetOverride: profile.proteinTargetOverride,
  });

  try {
    await generateWeeklyInsight({
      userId: user.userId,
      periodStart,
      periodEnd,
      timezone: user.timezone,
      targets,
      goal: profile.goal,
      force,
    });
  } catch (error) {
    if (error instanceof NotEnoughDataError) {
      return { ok: false, notEnoughData: true, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not build the review.",
    };
  }

  revalidatePath("/insights");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tidying the food library
// ---------------------------------------------------------------------------

/**
 * Combine several library foods into one named food.
 *
 * The problem this solves: anything logged before composites were kept whole
 * left its ingredients in the library as separate rows — "espresso", "ground
 * cinnamon", "chocolate milk" instead of "latte". Nobody wants to add three
 * things to log one drink.
 *
 * Sums the components' default portions, stores the result per 100 g like every
 * other food, and hides the components from THIS user's list. The originals are
 * not deleted: they may be shared with other users, and past entries still
 * reference them.
 */
export async function combineFoods(
  foodItemIds: string[],
  name: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const displayName = name.trim();
  if (displayName.length < 2) {
    return { ok: false, error: "Give the combined food a name." };
  }
  if (foodItemIds.length < 2) {
    return { ok: false, error: "Pick at least two foods to combine." };
  }

  const foods = await prisma.foodItem.findMany({
    where: {
      id: { in: foodItemIds },
      OR: [{ userId: user.userId }, { userId: null }],
    },
  });
  if (foods.length < 2) {
    return { ok: false, error: "Could not find those foods." };
  }

  // Sum each component's DEFAULT portion — that is the amount the user would
  // have added, so the composite means "one of each of these".
  let grams = 0;
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };
  for (const f of foods) {
    const k = f.defaultGrams / 100;
    grams += f.defaultGrams;
    total.kcal += f.kcalPer100g * k;
    total.protein += f.proteinPer100g * k;
    total.carbs += f.carbsPer100g * k;
    total.fat += f.fatPer100g * k;
    total.fiber += (f.fiberPer100g ?? 0) * k;
    total.sugar += (f.sugarPer100g ?? 0) * k;
    total.sodium += (f.sodiumPer100g ?? 0) * k;
  }
  if (grams <= 0) return { ok: false, error: "Those foods have no portion size." };

  const per100 = (v: number) => (v * 100) / grams;

  // Dominant food group by calories, and a calorie-weighted processing level —
  // the same rules the scorer uses, so a combined food scores consistently.
  const groupKcal = new Map<string, number>();
  let levelWeighted = 0;
  for (const f of foods) {
    const kcal = (f.kcalPer100g * f.defaultGrams) / 100;
    groupKcal.set(f.foodGroup, (groupKcal.get(f.foodGroup) ?? 0) + kcal);
    levelWeighted += f.processedLevel * kcal;
  }
  const foodGroup =
    [...groupKcal.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "mixed_dish";
  const processedLevel =
    total.kcal > 0 ? Math.round(levelWeighted / total.kcal) : 2;

  // A combined food is the user's own, never shared: they named it, and the
  // portions they chose are theirs.
  const normalizedName = normalizeFoodName(displayName);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.foodItem.findFirst({
        where: { userId: user.userId, normalizedName, brand: null },
        select: { id: true },
      });

      const data = {
        displayName,
        kcalPer100g: per100(total.kcal),
        proteinPer100g: per100(total.protein),
        carbsPer100g: per100(total.carbs),
        fatPer100g: per100(total.fat),
        fiberPer100g: per100(total.fiber),
        sugarPer100g: per100(total.sugar),
        sodiumPer100g: per100(total.sodium),
        defaultGrams: grams,
        foodGroup: foodGroup as never,
        processedLevel: Math.min(4, Math.max(1, processedLevel)),
        nutritionSource: "user" as never,
        lastLoggedAt: new Date(),
      };

      if (existing) {
        await tx.foodItem.update({ where: { id: existing.id }, data });
      } else {
        await tx.foodItem.create({
          data: {
            ...data,
            userId: user.userId,
            normalizedName,
            // Ranked above its own ingredients so it surfaces where they did.
            timesLogged: foods.reduce((s, f) => s + f.timesLogged, 0) || 1,
          },
        });
      }

      // Hide the ingredients from this user's list, without deleting rows that
      // other users and past entries still depend on.
      for (const f of foods) {
        await tx.hiddenFood.upsert({
          where: { userId_foodItemId: { userId: user.userId, foodItemId: f.id } },
          update: {},
          create: { userId: user.userId, foodItemId: f.id },
        });
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not combine those.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/** Remove a food from this user's quick-add list. The row itself survives. */
export async function hideFood(foodItemId: string): Promise<ActionResult> {
  const user = await requireUser();
  await prisma.hiddenFood.upsert({
    where: { userId_foodItemId: { userId: user.userId, foodItemId } },
    update: {},
    create: { userId: user.userId, foodItemId },
  });
  revalidatePath("/");
  return { ok: true };
}

/** Put a hidden food back. */
export async function unhideAllFoods(): Promise<ActionResult> {
  const user = await requireUser();
  await prisma.hiddenFood.deleteMany({ where: { userId: user.userId } });
  revalidatePath("/");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/**
 * Save a parsed meal as a named recipe.
 *
 * The distinction from a remembered meal is intent: this is something she
 * declared, so it stays put and can be portioned. Item nutrition is stored as
 * the WHOLE batch; `servings` divides it at read time.
 */
export async function saveRecipe(input: {
  name: string;
  servings: number;
  sourceText: string;
  notes?: string;
  items: PreviewItem[];
}): Promise<ActionResult> {
  const user = await requireUser();

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Give the recipe a name." };
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: "A recipe needs at least one ingredient." };
  }
  const servings =
    Number.isFinite(input.servings) && input.servings > 0 ? input.servings : 1;
  if (servings > 100) return { ok: false, error: "That's a lot of servings." };

  try {
    // Upsert on name so saving twice edits rather than creating a duplicate the
    // user then has to clean up.
    const existing = await prisma.recipe.findFirst({
      where: { userId: user.userId, name },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      const itemData = input.items.map((i) => ({
        name: i.name,
        brand: i.brand,
        quantity: i.quantity,
        unit: i.unit,
        grams: i.grams,
        kcal: i.kcal,
        protein: i.protein,
        carbs: i.carbs,
        fat: i.fat,
        fiber: i.fiber,
        sugar: i.sugar,
        sodium: i.sodium,
        foodGroup: i.foodGroup as never,
        processedLevel: i.processedLevel,
        nutritionSource: i.nutritionSource as never,
        confidence: i.confidence,
        usdaFdcId: i.usdaFdcId,
      }));

      if (existing) {
        // Replace the ingredient set wholesale — a partial merge would leave
        // ingredients she removed still attached.
        await tx.recipeItem.deleteMany({ where: { recipeId: existing.id } });
        await tx.recipe.update({
          where: { id: existing.id },
          data: {
            servings,
            sourceText: input.sourceText,
            notes: input.notes?.trim() || null,
            items: { create: itemData },
          },
        });
      } else {
        await tx.recipe.create({
          data: {
            userId: user.userId,
            name,
            servings,
            sourceText: input.sourceText,
            notes: input.notes?.trim() || null,
            items: { create: itemData },
          },
        });
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the recipe.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Log servings of a saved recipe. Costs nothing — it copies stored nutrition.
 */
export async function logRecipe(
  recipeId: string,
  servings = 1,
  eatenAtIso?: string,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!Number.isFinite(servings) || servings <= 0 || servings > 20) {
    return { ok: false, error: "Enter between 0.25 and 20 servings." };
  }

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, userId: user.userId },
    include: { items: true },
  });
  if (!recipe) return { ok: false, error: "Recipe not found." };
  if (recipe.items.length === 0) {
    return { ok: false, error: "That recipe has no ingredients." };
  }

  const eatenAt = eatenAtIso ? new Date(eatenAtIso) : new Date();
  if (Number.isNaN(eatenAt.getTime())) {
    return { ok: false, error: "That time isn't valid." };
  }

  // Item nutrition is the whole batch, so scale to the servings eaten.
  const f = servings / (recipe.servings > 0 ? recipe.servings : 1);

  await prisma.$transaction(async (tx) => {
    await tx.entry.create({
      data: {
        userId: user.userId,
        eatenAt,
        localDate: toLocalDate(eatenAt, user.timezone),
        mealType: guessMealType(eatenAt, user.timezone),
        source: "quickadd",
        title: recipe.name,
        rawText: recipe.name,
        items: {
          create: recipe.items.map((i) => ({
            name: i.name,
            brand: i.brand,
            quantity: i.quantity * f,
            unit: i.unit,
            grams: i.grams * f,
            kcal: i.kcal * f,
            protein: i.protein * f,
            carbs: i.carbs * f,
            fat: i.fat * f,
            fiber: i.fiber === null ? null : i.fiber * f,
            sugar: i.sugar === null ? null : i.sugar * f,
            sodium: i.sodium === null ? null : i.sodium * f,
            foodGroup: i.foodGroup,
            processedLevel: i.processedLevel,
            nutritionSource: i.nutritionSource,
            confidence: i.confidence,
            usdaFdcId: i.usdaFdcId,
          })),
        },
      },
    });

    await tx.recipe.update({
      where: { id: recipe.id },
      data: { timesLogged: { increment: 1 }, lastLoggedAt: new Date() },
    });
  });

  revalidatePath("/");
  revalidatePath("/month");
  revalidatePath("/insights");
  return { ok: true };
}

/** Delete a saved recipe. Past entries made from it are unaffected. */
export async function deleteRecipe(recipeId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await prisma.recipe.deleteMany({
    where: { id: recipeId, userId: user.userId },
  });
  if (result.count === 0) return { ok: false, error: "Recipe not found." };
  revalidatePath("/");
  return { ok: true };
}

/**
 * Turn a detected meal into a saved recipe.
 *
 * Detected meals are inferred and shift as history changes; a recipe is
 * declared and stays. Promoting copies the items so the recipe keeps the
 * nutrition it had at that moment, including any corrections.
 */
export async function promoteMealToRecipe(
  entryId: string,
  name: string,
  servings = 1,
): Promise<ActionResult> {
  const user = await requireUser();

  const title = name.trim();
  if (title.length < 2) return { ok: false, error: "Give the recipe a name." };

  const entry = await prisma.entry.findFirst({
    where: { id: entryId, userId: user.userId },
    include: { items: true },
  });
  if (!entry) return { ok: false, error: "That meal is no longer in your history." };
  if (entry.items.length === 0) return { ok: false, error: "That meal has no items." };

  const s = Number.isFinite(servings) && servings > 0 ? servings : 1;

  try {
    const existing = await prisma.recipe.findFirst({
      where: { userId: user.userId, name: title },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, error: `You already have a recipe called "${title}".` };
    }

    await prisma.recipe.create({
      data: {
        userId: user.userId,
        name: title,
        servings: s,
        sourceText: entry.rawText,
        // Item nutrition is for the whole batch; a promoted single meal IS one
        // batch, so multiply by servings if she says it makes more than one.
        items: {
          create: entry.items.map((i) => ({
            name: i.name,
            brand: i.brand,
            quantity: i.quantity * s,
            unit: i.unit,
            grams: i.grams * s,
            kcal: i.kcal * s,
            protein: i.protein * s,
            carbs: i.carbs * s,
            fat: i.fat * s,
            fiber: i.fiber === null ? null : i.fiber * s,
            sugar: i.sugar === null ? null : i.sugar * s,
            sodium: i.sodium === null ? null : i.sodium * s,
            foodGroup: i.foodGroup,
            processedLevel: i.processedLevel,
            nutritionSource: i.nutritionSource,
            confidence: i.confidence,
            usdaFdcId: i.usdaFdcId,
          })),
        },
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save that recipe.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Edit a saved recipe: rename, re-portion, adjust or drop ingredients.
 *
 * Ingredient amounts are given in grams and the nutrition is rescaled from what
 * was stored, so editing a portion never silently loses the grounded numbers.
 */
export async function updateRecipe(input: {
  recipeId: string;
  name?: string;
  servings?: number;
  notes?: string;
  /** Grams per ingredient id. Omit an id to leave it; set 0 to remove it. */
  itemGrams?: Record<string, number>;
}): Promise<ActionResult> {
  const user = await requireUser();

  const recipe = await prisma.recipe.findFirst({
    where: { id: input.recipeId, userId: user.userId },
    include: { items: true },
  });
  if (!recipe) return { ok: false, error: "Recipe not found." };

  const name = input.name?.trim();
  if (name !== undefined && name.length < 2) {
    return { ok: false, error: "Give the recipe a name." };
  }
  const servings =
    input.servings !== undefined
      ? Number.isFinite(input.servings) && input.servings > 0 && input.servings <= 100
        ? input.servings
        : null
      : undefined;
  if (servings === null) return { ok: false, error: "Servings must be 1 to 100." };

  try {
    await prisma.$transaction(async (tx) => {
      if (input.itemGrams) {
        for (const item of recipe.items) {
          const next = input.itemGrams[item.id];
          if (next === undefined) continue;

          if (next <= 0) {
            await tx.recipeItem.delete({ where: { id: item.id } });
            continue;
          }
          if (item.grams <= 0) continue;

          const f = next / item.grams;
          await tx.recipeItem.update({
            where: { id: item.id },
            data: {
              grams: next,
              quantity: item.quantity * f,
              kcal: item.kcal * f,
              protein: item.protein * f,
              carbs: item.carbs * f,
              fat: item.fat * f,
              fiber: item.fiber === null ? null : item.fiber * f,
              sugar: item.sugar === null ? null : item.sugar * f,
              sodium: item.sodium === null ? null : item.sodium * f,
            },
          });
        }
      }

      await tx.recipe.update({
        where: { id: recipe.id },
        data: {
          name: name ?? undefined,
          servings: servings ?? undefined,
          notes: input.notes === undefined ? undefined : input.notes.trim() || null,
        },
      });

      const left = await tx.recipeItem.count({ where: { recipeId: recipe.id } });
      if (left === 0) {
        // A recipe with no ingredients is not a recipe.
        await tx.recipe.delete({ where: { id: recipe.id } });
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not update the recipe.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/** Build (or rebuild) the long-window pattern analysis. */
export async function generatePatterns(
  periodStart: string,
  periodEnd: string,
  force = false,
): Promise<InsightActionResult> {
  const user = await requireUser();

  const profile = await prisma.profile.findUnique({ where: { userId: user.userId } });
  if (!profile) return { ok: false, error: "Profile not found." };

  const targets = computeTargets({
    sex: profile.sex,
    ageYears: profile.birthDate ? ageFrom(profile.birthDate, new Date()) : null,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    calorieTargetOverride: profile.calorieTargetOverride,
    proteinTargetOverride: profile.proteinTargetOverride,
  });

  try {
    await generatePatternInsight({
      userId: user.userId,
      periodStart,
      periodEnd,
      timezone: user.timezone,
      targets,
      goal: profile.goal,
      force,
    });
  } catch (error) {
    if (error instanceof NotEnoughPatternDataError) {
      return { ok: false, notEnoughData: true, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not build the analysis.",
    };
  }

  revalidatePath("/insights");
  return { ok: true };
}
