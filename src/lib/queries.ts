/**
 * Read side of the data layer.
 *
 * Along with actions.ts, this is the ONLY file permitted to import `prisma`.
 * Every exported function takes `userId` as its first argument, supplied by
 * requireUser(). That is not a style preference: Prisma connects with database
 * credentials and bypasses Postgres RLS, so a query that forgets to scope by
 * user is a data leak. Keeping the scoping in one file makes it reviewable.
 */

import { prisma } from "@/lib/prisma";
import {
  ageFrom,
  computeDayScore,
  computeMealScore,
  computeTargets,
  type ActivityLevel,
  type DayScore,
  type Goal,
  type MealScore,
  type MealType,
  type Sex,
  type Targets,
} from "@/lib/scoring";
import {
  isoDateToUtc,
  monthBounds,
  monthDays,
  toLocalMinutes,
  utcToIsoDate,
  type IsoDate,
} from "@/lib/time";
import type { NutritionSource } from "@/lib/nutrition/ground";
import type { FoodGroup } from "@/lib/nutrition/types";
import { waterTarget, type UnitSystem } from "@/lib/units";

export interface ProfileView {
  userId: string;
  unitSystem: UnitSystem;
  email: string;
  name: string | null;
  timezone: string;
  sex: Sex | null;
  birthDate: Date | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel;
  goal: Goal;
  calorieTargetOverride: number | null;
  proteinTargetOverride: number | null;
  bedtimeMinutes: number;
  eatingWindowEnabled: boolean;
  eatingWindowStart: number;
  eatingWindowEnd: number;
  waterTargetMl: number | null;
}

/** The signed-in user's profile, or null if it has been deleted mid-session. */
export async function getProfile(userId: string): Promise<ProfileView | null> {
  const p = await prisma.profile.findUnique({ where: { userId } });
  if (!p) return null;
  return {
    userId: p.userId,
    unitSystem: p.unitSystem,
    email: p.email,
    name: p.name,
    timezone: p.timezone,
    sex: p.sex,
    birthDate: p.birthDate,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    activityLevel: p.activityLevel,
    goal: p.goal,
    calorieTargetOverride: p.calorieTargetOverride,
    proteinTargetOverride: p.proteinTargetOverride,
    bedtimeMinutes: p.bedtimeMinutes,
    eatingWindowEnabled: p.eatingWindowEnabled,
    eatingWindowStart: p.eatingWindowStart,
    eatingWindowEnd: p.eatingWindowEnd,
    waterTargetMl: p.waterTargetMl,
  };
}

/**
 * Turn a profile into calorie/protein targets.
 *
 * `now` is a parameter rather than an implicit `new Date()` so this stays
 * testable and so a single request computes one consistent age.
 */
export function targetsForProfile(
  profile: ProfileView,
  now: Date = new Date(),
): Targets {
  return computeTargets({
    sex: profile.sex,
    ageYears: profile.birthDate ? ageFrom(profile.birthDate, now) : null,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    calorieTargetOverride: profile.calorieTargetOverride,
    proteinTargetOverride: profile.proteinTargetOverride,
  });
}

/**
 * All profiles, for the dev-mode user switcher only.
 *
 * Intentionally NOT user-scoped, which is exactly why it is guarded: it exists
 * to let the pilot hop between the two seeded accounts and must never be
 * reachable when real auth is in play.
 */
export async function listDevProfiles(): Promise<
  { userId: string; email: string; name: string | null }[]
> {
  const { authMode } = await import("@/lib/env");
  if (authMode() !== "dev") {
    throw new Error("listDevProfiles() is only available under AUTH_MODE=dev.");
  }
  return prisma.profile.findMany({
    orderBy: { createdAt: "asc" },
    select: { userId: true, email: true, name: true },
  });
}

// ---------------------------------------------------------------------------
// Day and month reads
// ---------------------------------------------------------------------------

export interface DayItemView {
  id: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  foodGroup: FoodGroup;
  processedLevel: number;
  nutritionSource: NutritionSource;
  confidence: number;
}

export interface DayEntryView {
  id: string;
  eatenAt: Date;
  localMinutes: number;
  mealType: MealType;
  source: string;
  rawText: string | null;
  restaurantName: string | null;
  items: DayItemView[];
  /** Scored on properties intrinsic to the meal — see computeMealScore. */
  score: MealScore | null;
}

export interface DayView {
  date: IsoDate;
  entries: DayEntryView[];
  score: DayScore | null;
}

/**
 * One local day's entries plus its score.
 *
 * Ranges over the indexed `localDate` column rather than computing timezone math
 * in SQL — that is the whole reason the column is denormalized.
 */
export async function getDay(
  userId: string,
  date: IsoDate,
  timezone: string,
  targets: { kcal: number; protein: number },
  bedtimeMinutes: number,
  goal: Goal,
  eatingWindow: { start: number; end: number } | null = null,
): Promise<DayView> {
  const rows = await prisma.entry.findMany({
    where: { userId, localDate: isoDateToUtc(date) },
    orderBy: { eatenAt: "asc" },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  const entries: DayEntryView[] = rows.map((e) => {
    const items: DayItemView[] = e.items.map((i) => ({
      id: i.id,
      name: i.name,
      brand: i.brand,
      quantity: i.quantity,
      unit: i.unit,
      grams: i.grams,
      kcal: i.kcal,
      protein: i.protein,
      carbs: i.carbs,
      fat: i.fat,
      fiber: i.fiber ?? 0,
      foodGroup: i.foodGroup as FoodGroup,
      processedLevel: i.processedLevel,
      nutritionSource: i.nutritionSource as NutritionSource,
      confidence: i.confidence,
    }));

    return {
      id: e.id,
      eatenAt: e.eatenAt,
      localMinutes: toLocalMinutes(e.eatenAt, timezone),
      mealType: e.mealType,
      source: e.source,
      rawText: e.rawText,
      restaurantName: e.restaurantName,
      items,
      score: computeMealScore(
        items.map((i) => ({
          kcal: i.kcal,
          protein: i.protein,
          carbs: i.carbs,
          fat: i.fat,
          fiber: i.fiber,
          processedLevel: i.processedLevel,
        })),
        e.mealType,
        targets.kcal,
      ),
    };
  });

  const allItems = entries.flatMap((e) => e.items);

  const score = computeDayScore({
    items: allItems.map((i) => ({
      kcal: i.kcal,
      protein: i.protein,
      carbs: i.carbs,
      fat: i.fat,
      processedLevel: i.processedLevel,
    })),
    meals: entries.map((e) => ({ localMinutes: e.localMinutes })),
    targets,
    bedtimeMinutes,
    goal,
    eatingWindow,
  });

  return { date, entries, score };
}

/** Today's parse count, for showing remaining quota in the UI. */
export async function getParseUsage(
  userId: string,
  date: IsoDate,
): Promise<{ used: number; costCents: number }> {
  const row = await prisma.parseUsage.findUnique({
    where: { userId_localDate: { userId, localDate: isoDateToUtc(date) } },
  });
  return {
    used: row?.parseCount ?? 0,
    costCents: row?.estimatedCostCents ?? 0,
  };
}

/** Most-logged foods, for quick-add. The "what do I actually eat" signal. */
export async function getFrequentFoods(
  userId: string,
  limit = 12,
): Promise<
  {
    id: string;
    displayName: string;
    brand: string | null;
    defaultGrams: number;
    kcalPer100g: number;
    timesLogged: number;
  }[]
> {
  return prisma.foodItem.findMany({
    where: { OR: [{ userId }, { userId: null }], timesLogged: { gt: 0 } },
    orderBy: [{ timesLogged: "desc" }, { lastLoggedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      displayName: true,
      brand: true,
      defaultGrams: true,
      kcalPer100g: true,
      timesLogged: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Month rollup
// ---------------------------------------------------------------------------

export interface MonthDay {
  date: IsoDate;
  /** Null for a day with nothing logged — an untracked day is not a zero. */
  score: number | null;
  kcal: number;
  protein: number;
  mealCount: number;
  isFuture: boolean;
}

export interface MonthView {
  month: IsoDate;
  days: MonthDay[];
  summary: {
    trackedDays: number;
    totalDaysElapsed: number;
    /** Mean score over TRACKED days only. */
    averageScore: number | null;
    averageKcal: number | null;
    averageMeals: number | null;
    /** Days within +/-10% of the calorie target. */
    daysOnTarget: number;
    bestDay: { date: IsoDate; score: number } | null;
    worstDay: { date: IsoDate; score: number } | null;
  };
  /** Calories by food group across the month, biggest first. */
  foodGroups: { group: FoodGroup; kcal: number; share: number }[];
}

/**
 * One month of daily scores plus rollups.
 *
 * A single indexed range scan over `localDate` feeds everything here — that is
 * what the denormalized column buys. Scores are computed on read rather than
 * stored, so there is no cache to go stale.
 */
export async function getMonth(
  userId: string,
  monthAnchor: IsoDate,
  timezone: string,
  targets: { kcal: number; protein: number },
  bedtimeMinutes: number,
  goal: Goal,
  eatingWindow: { start: number; end: number } | null,
  today: IsoDate,
): Promise<MonthView> {
  const { start, end } = monthBounds(monthAnchor);

  const rows = await prisma.entry.findMany({
    where: { userId, localDate: { gte: start, lte: end } },
    orderBy: { eatenAt: "asc" },
    include: { items: true },
  });

  // Bucket entries by their stored local date.
  const byDate = new Map<IsoDate, typeof rows>();
  for (const row of rows) {
    const key = utcToIsoDate(row.localDate);
    const list = byDate.get(key);
    if (list) list.push(row);
    else byDate.set(key, [row]);
  }

  const days: MonthDay[] = monthDays(monthAnchor).map((date) => {
    const entries = byDate.get(date) ?? [];
    const items = entries.flatMap((e) => e.items);

    const score = computeDayScore({
      items: items.map((i) => ({
        kcal: i.kcal,
        protein: i.protein,
        carbs: i.carbs,
        fat: i.fat,
        fiber: i.fiber ?? 0,
        processedLevel: i.processedLevel,
      })),
      meals: entries.map((e) => ({
        localMinutes: toLocalMinutes(e.eatenAt, timezone),
      })),
      targets,
      bedtimeMinutes,
      goal,
      eatingWindow,
    });

    return {
      date,
      score: score?.total ?? null,
      kcal: score?.totals.kcal ?? 0,
      protein: score?.totals.protein ?? 0,
      mealCount: entries.length,
      // Future days render as empty rather than as untracked failures.
      isFuture: date > today,
    };
  });

  const tracked = days.filter((d) => d.score !== null);
  const elapsed = days.filter((d) => !d.isFuture).length;

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  const ranked = [...tracked].sort((a, b) => b.score! - a.score!);

  // --- Food groups. Nominal categories, so this is a magnitude comparison, not
  // an identity one: one hue, sorted by size. See the chart component.
  const groupTotals = new Map<FoodGroup, number>();
  for (const row of rows) {
    for (const item of row.items) {
      const g = item.foodGroup as FoodGroup;
      groupTotals.set(g, (groupTotals.get(g) ?? 0) + item.kcal);
    }
  }
  const totalGroupKcal = [...groupTotals.values()].reduce((a, b) => a + b, 0);
  const foodGroups = [...groupTotals.entries()]
    .map(([group, kcal]) => ({
      group,
      kcal: Math.round(kcal),
      share: totalGroupKcal > 0 ? kcal / totalGroupKcal : 0,
    }))
    .sort((a, b) => b.kcal - a.kcal);

  return {
    month: monthAnchor,
    days,
    summary: {
      trackedDays: tracked.length,
      totalDaysElapsed: elapsed,
      averageScore:
        mean(tracked.map((d) => d.score!)) === null
          ? null
          : Math.round(mean(tracked.map((d) => d.score!))!),
      averageKcal:
        mean(tracked.map((d) => d.kcal)) === null
          ? null
          : Math.round(mean(tracked.map((d) => d.kcal))!),
      averageMeals:
        mean(tracked.map((d) => d.mealCount)) === null
          ? null
          : Math.round(mean(tracked.map((d) => d.mealCount))! * 10) / 10,
      daysOnTarget: tracked.filter(
        (d) => Math.abs(d.kcal - targets.kcal) / targets.kcal <= 0.1,
      ).length,
      bestDay: ranked[0] ? { date: ranked[0].date, score: ranked[0].score! } : null,
      worstDay:
        ranked.length > 1
          ? {
              date: ranked[ranked.length - 1].date,
              score: ranked[ranked.length - 1].score!,
            }
          : null,
    },
    foodGroups,
  };
}

// ---------------------------------------------------------------------------
// Memory: what this user has eaten before
// ---------------------------------------------------------------------------

export interface RememberedMeal {
  /** The most recent entry with this text — the one re-logging copies. */
  entryId: string;
  rawText: string;
  restaurantName: string | null;
  itemCount: number;
  kcal: number;
  protein: number;
  timesLogged: number;
  lastEatenAt: Date;
}

/**
 * Meals this user has logged before, most-used first.
 *
 * This is the answer to "why should I have to build recipes?" — a meal typed
 * once is a meal the app knows. Grouping is by the raw text the user actually
 * typed, because that IS their name for it; asking them to name a recipe
 * separately would be asking them to do the app's job.
 *
 * Ranked by frequency then recency, so staples surface above one-offs.
 */
export async function getRememberedMeals(
  userId: string,
  limit = 8,
): Promise<RememberedMeal[]> {
  // Group in SQL rather than pulling every entry into memory: this runs on the
  // Today page, and a year of history is thousands of rows.
  const groups = await prisma.$queryRaw<
    {
      rawText: string;
      times: bigint;
      lastAt: Date;
      entryId: string;
    }[]
  >`
    SELECT DISTINCT ON (lower(btrim(e."rawText")))
      e."rawText"          AS "rawText",
      count(*) OVER (PARTITION BY lower(btrim(e."rawText"))) AS times,
      max(e."eatenAt") OVER (PARTITION BY lower(btrim(e."rawText"))) AS "lastAt",
      e.id                 AS "entryId"
    FROM "Entry" e
    WHERE e."userId" = ${userId}
      AND e."rawText" IS NOT NULL
      AND btrim(e."rawText") <> ''
    ORDER BY lower(btrim(e."rawText")), e."eatenAt" DESC
  `;

  if (groups.length === 0) return [];

  // Pull the item totals for just the representative entries.
  const rows = await prisma.entry.findMany({
    where: { id: { in: groups.map((g) => g.entryId) } },
    include: { items: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return groups
    .map((g) => {
      const entry = byId.get(g.entryId);
      if (!entry) return null;
      return {
        entryId: g.entryId,
        rawText: g.rawText,
        restaurantName: entry.restaurantName,
        itemCount: entry.items.length,
        kcal: Math.round(entry.items.reduce((s, i) => s + i.kcal, 0)),
        protein: Math.round(entry.items.reduce((s, i) => s + i.protein, 0)),
        timesLogged: Number(g.times),
        lastEatenAt: g.lastAt,
      };
    })
    .filter((m): m is RememberedMeal => m !== null)
    .sort(
      (a, b) =>
        b.timesLogged - a.timesLogged ||
        b.lastEatenAt.getTime() - a.lastEatenAt.getTime(),
    )
    .slice(0, limit);
}

export interface RememberedFood {
  id: string;
  displayName: string;
  brand: string | null;
  defaultGrams: number;
  unitIsServing: boolean;
  kcalForDefault: number;
  timesLogged: number;
}

/**
 * Individual foods this user reaches for, most-used first.
 *
 * Complements remembered meals: sometimes you want the whole lunch again, and
 * sometimes just the yoghurt.
 */
export async function getRememberedFoods(
  userId: string,
  limit = 12,
): Promise<RememberedFood[]> {
  const rows = await prisma.foodItem.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      timesLogged: { gt: 0 },
    },
    orderBy: [{ timesLogged: "desc" }, { lastLoggedAt: "desc" }],
    take: limit,
  });

  return rows.map((f) => ({
    id: f.id,
    displayName: f.displayName,
    brand: f.brand,
    defaultGrams: f.defaultGrams,
    // A barcode row carries a real label serving; a parsed food does not.
    unitIsServing: f.barcode !== null,
    kcalForDefault: Math.round((f.kcalPer100g * f.defaultGrams) / 100),
    timesLogged: f.timesLogged,
  }));
}


// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

export interface WaterLogView {
  id: string;
  drankAt: Date;
  localMinutes: number;
  ml: number;
}

export interface WaterDay {
  totalMl: number;
  targetMl: number;
  logs: WaterLogView[];
}

/**
 * One local day's water, against the user's goal.
 *
 * Ranges over the same denormalized `localDate` column the food views use, so a
 * drink at 11pm counts toward the right day.
 */
export async function getWaterForDay(
  userId: string,
  date: IsoDate,
  timezone: string,
  weightKg: number | null,
  overrideMl: number | null,
): Promise<WaterDay> {
  const rows = await prisma.waterLog.findMany({
    where: { userId, localDate: isoDateToUtc(date) },
    orderBy: { drankAt: "asc" },
  });

  return {
    totalMl: rows.reduce((s, r) => s + r.ml, 0),
    targetMl: waterTarget(weightKg, overrideMl),
    logs: rows.map((r) => ({
      id: r.id,
      drankAt: r.drankAt,
      localMinutes: toLocalMinutes(r.drankAt, timezone),
      ml: r.ml,
    })),
  };
}

/** Daily water totals across a month, for the month view. */
export async function getWaterForMonth(
  userId: string,
  monthAnchor: IsoDate,
): Promise<Map<IsoDate, number>> {
  const { start, end } = monthBounds(monthAnchor);
  const rows = await prisma.waterLog.groupBy({
    by: ["localDate"],
    where: { userId, localDate: { gte: start, lte: end } },
    _sum: { ml: true },
  });

  const out = new Map<IsoDate, number>();
  for (const r of rows) out.set(utcToIsoDate(r.localDate), r._sum.ml ?? 0);
  return out;
}
