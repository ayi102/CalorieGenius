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
import { Prisma } from "@/generated/prisma/client";
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
  title: string | null;
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
      title: e.title,
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
  /** The card title, e.g. "Homemade Coffee". */
  title: string;
  /** What she typed. Secondary — shown small, under the title. */
  rawText: string;
  restaurantName: string | null;
  itemCount: number;
  /** The individual foods, so the picker can show what's in a recipe. */
  items: { name: string; grams: number; kcal: number }[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Scored as a meal, so a recipe can be judged before it's added. */
  score: MealScore | null;
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
  targetKcal: number,
  // Detected meals accumulate forever; 20 is enough to cover what someone
  // actually rotates through, and search covers the rest.
  limit = 20,
): Promise<RememberedMeal[]> {
  // Group in SQL rather than pulling every entry into memory: this runs on the
  // Today page, and a year of history is thousands of rows.
  const groups = await prisma.$queryRaw<
    {
      rawText: string;
      title: string | null;
      times: bigint;
      lastAt: Date;
      entryId: string;
    }[]
  >`
    SELECT DISTINCT ON (lower(btrim(coalesce(e.title, e."rawText"))))
      e."rawText"          AS "rawText",
      e.title              AS title,
      count(*) OVER (PARTITION BY lower(btrim(coalesce(e.title, e."rawText")))) AS times,
      max(e."eatenAt") OVER (PARTITION BY lower(btrim(coalesce(e.title, e."rawText")))) AS "lastAt",
      e.id                 AS "entryId"
    FROM "Entry" e
    WHERE e."userId" = ${userId}
      AND coalesce(e.title, e."rawText") IS NOT NULL
      AND btrim(coalesce(e.title, e."rawText")) <> ''
    ORDER BY lower(btrim(coalesce(e.title, e."rawText"))), e."eatenAt" DESC
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
      const scoreItems = entry.items.map((i) => ({
        kcal: i.kcal,
        protein: i.protein,
        carbs: i.carbs,
        fat: i.fat,
        fiber: i.fiber ?? 0,
        processedLevel: i.processedLevel,
      }));

      return {
        entryId: g.entryId,
        // Older entries predate auto-titling; fall back to their text.
        title: g.title?.trim() || g.rawText,
        rawText: g.rawText,
        restaurantName: entry.restaurantName,
        itemCount: entry.items.length,
        items: entry.items.map((i) => ({
          name: i.name,
          grams: Math.round(i.grams),
          kcal: Math.round(i.kcal),
        })),
        kcal: Math.round(entry.items.reduce((s, i) => s + i.kcal, 0)),
        protein: Math.round(entry.items.reduce((s, i) => s + i.protein, 0)),
        carbs: Math.round(entry.items.reduce((s, i) => s + i.carbs, 0)),
        fat: Math.round(entry.items.reduce((s, i) => s + i.fat, 0)),
        fiber: Math.round(entry.items.reduce((s, i) => s + (i.fiber ?? 0), 0)),
        // Scored against the meal slot it was actually eaten in.
        score: computeMealScore(scoreItems, entry.mealType, targetKcal),
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
  /** Full nutrition for the default portion — not just calories. */
  kcalForDefault: number;
  proteinForDefault: number;
  carbsForDefault: number;
  fatForDefault: number;
  fiberForDefault: number;
  foodGroup: string;
  processedLevel: number;
  nutritionSource: string;
  timesLogged: number;
  /**
   * How often this food has been the ONLY thing in an entry.
   *
   * Zero means it has only ever appeared alongside other foods — so it is a
   * component of a meal, and the meal (which carries the name she typed) is the
   * better thing to re-log. Used to rank, not to hide: a food she has never
   * eaten alone is still one she might choose to.
   */
  soloCount: number;
}

/**
 * Individual foods this user reaches for, most-used first.
 *
 * Complements remembered meals: sometimes you want the whole lunch again, and
 * sometimes just the yoghurt.
 */
export async function getRememberedFoods(
  userId: string,
  limit = 40,
): Promise<RememberedFood[]> {
  const rows = await prisma.foodItem.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      timesLogged: { gt: 0 },
      // Ingredients folded into a combined food are hidden for this user only —
      // the rows survive for everyone else and for past entries.
      hiddenBy: { none: { userId } },
    },
    orderBy: [{ timesLogged: "desc" }, { lastLoggedAt: "desc" }],
    take: limit,
  });

  /**
   * How many times each of these foods was the sole item of an entry.
   *
   * Derived rather than asked of the user: the log already records whether she
   * ate a thing on its own or as part of something, so there is no reason to
   * make her tell the app which is which.
   */
  const soloRows =
    rows.length === 0
      ? []
      : await prisma.$queryRaw<{ foodItemId: string; solo: bigint }[]>`
          SELECT i."foodItemId", count(*) AS solo
          FROM "EntryItem" i
          JOIN "Entry" e ON e.id = i."entryId"
          JOIN (
            SELECT "entryId", count(*) AS n FROM "EntryItem" GROUP BY "entryId"
          ) c ON c."entryId" = i."entryId"
          WHERE e."userId" = ${userId}
            AND c.n = 1
            AND i."foodItemId" IN (${Prisma.join(rows.map((r) => r.id))})
          GROUP BY i."foodItemId"
        `;
  const soloBy = new Map(soloRows.map((r) => [r.foodItemId, Number(r.solo)]));

  return rows.map((f) => {
    // Everything is stored per 100 g; scale once to the default portion.
    const k = f.defaultGrams / 100;
    return {
      id: f.id,
      displayName: f.displayName,
      brand: f.brand,
      defaultGrams: f.defaultGrams,
      // A barcode row carries a real label serving; a parsed food does not.
      unitIsServing: f.barcode !== null,
      kcalForDefault: Math.round(f.kcalPer100g * k),
      proteinForDefault: Math.round(f.proteinPer100g * k),
      carbsForDefault: Math.round(f.carbsPer100g * k),
      fatForDefault: Math.round(f.fatPer100g * k),
      fiberForDefault: Math.round((f.fiberPer100g ?? 0) * k),
      foodGroup: f.foodGroup,
      processedLevel: f.processedLevel,
      nutritionSource: f.nutritionSource,
      timesLogged: f.timesLogged,
      // A barcode product is inherently standalone — it came out of a packet.
      soloCount: soloBy.get(f.id) ?? (f.barcode !== null ? 1 : 0),
    };
  });
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

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export interface WeightPoint {
  date: IsoDate;
  weightKg: number;
}

export interface WeightHistory {
  points: WeightPoint[];
  latest: WeightPoint | null;
  /** Change over the window, in kg. Negative is loss. */
  changeKg: number | null;
  /** Change over the last 7 days, for the "this week" line. */
  weekChangeKg: number | null;
}

/**
 * Weigh-ins over a window, oldest first.
 *
 * Returns a change only when there are at least two points — a single weigh-in
 * has no trend, and showing "0.0 kg change" would imply one.
 */
export async function getWeightHistory(
  userId: string,
  days = 90,
): Promise<WeightHistory> {
  const rows = await prisma.weightLog.findMany({
    where: { userId },
    orderBy: { localDate: "asc" },
    take: 400,
  });

  const points = rows.map((r) => ({
    date: utcToIsoDate(r.localDate),
    weightKg: r.weightKg,
  }));

  if (points.length === 0) {
    return { points, latest: null, changeKg: null, weekChangeKg: null };
  }

  const latest = points[points.length - 1];

  const cutoff = new Date(isoDateToUtc(latest.date));
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const inWindow = points.filter((p) => isoDateToUtc(p.date) >= cutoff);

  const weekCutoff = new Date(isoDateToUtc(latest.date));
  weekCutoff.setUTCDate(weekCutoff.getUTCDate() - 7);
  const inWeek = points.filter((p) => isoDateToUtc(p.date) >= weekCutoff);

  return {
    points: inWindow,
    latest,
    changeKg:
      inWindow.length >= 2 ? latest.weightKg - inWindow[0].weightKg : null,
    weekChangeKg:
      inWeek.length >= 2 ? latest.weightKg - inWeek[0].weightKg : null,
  };
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

/** A cached weekly report, if one exists for that week. */
export async function getInsight(
  userId: string,
  periodStart: IsoDate,
  kind: "weekly" | "patterns" = "weekly",
): Promise<{ report: unknown; generatedAt: Date; model: string } | null> {
  const row = await prisma.insight.findUnique({
    where: {
      userId_kind_periodStart: {
        userId,
        kind,
        periodStart: isoDateToUtc(periodStart),
      },
    },
  });
  if (!row) return null;
  return { report: row.content, generatedAt: row.generatedAt, model: row.model };
}

/** How many days in a window have any entries — gates the "generate" button. */
export async function countTrackedDays(
  userId: string,
  periodStart: IsoDate,
  periodEnd: IsoDate,
): Promise<number> {
  const rows = await prisma.entry.groupBy({
    by: ["localDate"],
    where: {
      userId,
      localDate: { gte: isoDateToUtc(periodStart), lte: isoDateToUtc(periodEnd) },
    },
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Usage and cost
// ---------------------------------------------------------------------------

export interface UsageSummary {
  totalParses: number;
  totalCostCents: number;
  daysWithParses: number;
  /** Last 30 local days. */
  recentParses: number;
  recentCostCents: number;
  /** Cents per parse across all time — the real figure, not an estimate. */
  averageCostCents: number | null;
  firstUsedAt: Date | null;
}

/**
 * What this user's food lookups have actually cost.
 *
 * Reads the ParseUsage meter, which is incremented at the point of every model
 * call — so this is a record of what happened, not a projection. Cache hits and
 * re-logged meals are absent by construction, which is why the number stays
 * lower than "meals logged" would suggest.
 */
export async function getUsageSummary(
  userId: string,
  today: IsoDate,
): Promise<UsageSummary> {
  const cutoff = isoDateToUtc(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);

  const [all, recent, first] = await Promise.all([
    prisma.parseUsage.aggregate({
      where: { userId },
      _sum: { parseCount: true, estimatedCostCents: true },
      _count: { _all: true },
    }),
    prisma.parseUsage.aggregate({
      where: { userId, localDate: { gte: cutoff } },
      _sum: { parseCount: true, estimatedCostCents: true },
    }),
    prisma.parseUsage.findFirst({
      where: { userId },
      orderBy: { localDate: "asc" },
      select: { localDate: true },
    }),
  ]);

  const totalParses = all._sum.parseCount ?? 0;
  const totalCostCents = all._sum.estimatedCostCents ?? 0;

  return {
    totalParses,
    totalCostCents,
    daysWithParses: all._count._all,
    recentParses: recent._sum.parseCount ?? 0,
    recentCostCents: recent._sum.estimatedCostCents ?? 0,
    averageCostCents: totalParses > 0 ? totalCostCents / totalParses : null,
    firstUsedAt: first?.localDate ?? null,
  };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export interface RecipeView {
  id: string;
  name: string;
  servings: number;
  notes: string | null;
  itemCount: number;
  items: { id: string; name: string; grams: number; kcal: number }[];
  /** Nutrition for ONE serving — what logging it actually adds. */
  perServing: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  score: MealScore | null;
  timesLogged: number;
  lastLoggedAt: Date | null;
}

/**
 * The user's saved recipes, most-used first.
 *
 * Nutrition is divided by `servings` because that is what logging one adds —
 * showing batch totals would mean a lasagne reads as 3,000 calories and nobody
 * would trust it.
 */
export async function getRecipes(
  userId: string,
  targetKcal: number,
): Promise<RecipeView[]> {
  const rows = await prisma.recipe.findMany({
    where: { userId },
    include: { items: true },
    orderBy: [{ timesLogged: "desc" }, { updatedAt: "desc" }],
  });

  return rows.map((r) => {
    const servings = r.servings > 0 ? r.servings : 1;
    const sum = (pick: (i: (typeof r.items)[number]) => number) =>
      r.items.reduce((s, i) => s + pick(i), 0);

    const perServing = {
      kcal: Math.round(sum((i) => i.kcal) / servings),
      protein: Math.round(sum((i) => i.protein) / servings),
      carbs: Math.round(sum((i) => i.carbs) / servings),
      fat: Math.round(sum((i) => i.fat) / servings),
      fiber: Math.round(sum((i) => i.fiber ?? 0) / servings),
    };

    return {
      id: r.id,
      name: r.name,
      servings,
      notes: r.notes,
      itemCount: r.items.length,
      items: r.items.map((i) => ({
        id: i.id,
        name: i.name,
        // Per serving for display; the editor works in batch grams.
        grams: Math.round(i.grams / servings),
        kcal: Math.round(i.kcal / servings),
      })),
      perServing,
      // Scored per serving, as lunch — the neutral slot, since a saved recipe
      // has no time of day attached.
      score: computeMealScore(
        r.items.map((i) => ({
          kcal: i.kcal / servings,
          protein: i.protein / servings,
          carbs: i.carbs / servings,
          fat: i.fat / servings,
          fiber: (i.fiber ?? 0) / servings,
          processedLevel: i.processedLevel,
        })),
        "lunch",
        targetKcal,
      ),
      timesLogged: r.timesLogged,
      lastLoggedAt: r.lastLoggedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Computed facts — no model call, available the moment there is any data
// ---------------------------------------------------------------------------

export interface KnownFacts {
  windowDays: number;
  daysTracked: number;
  /** Last COMPLETE day the averages cover — never today. */
  through: IsoDate | null;
  /** True when today has entries that are deliberately excluded. */
  todayExcluded: boolean;
  avgKcal: number | null;
  avgProtein: number | null;
  avgFiber: number | null;
  avgMealsPerDay: number | null;
  avgWaterMl: number | null;
  /** Meals eaten at a named restaurant, and what share of all meals that is. */
  mealsOut: number;
  totalMeals: number;
  eatingOutPct: number | null;
  /** Distinct days with at least one restaurant meal. */
  daysWithEatingOut: number;
  /** Share of calories from ultra-processed food (level 4). */
  ultraProcessedPct: number | null;
  daysOnTarget: number;
  targetKcal: number;
  weight: {
    startKg: number | null;
    latestKg: number | null;
    changeKg: number | null;
    /** kg per week, from a least-squares fit. Negative is loss. */
    ratePerWeekKg: number | null;
    weighIns: number;
  };
}

/**
 * Facts the app can state without asking a model anything.
 *
 * Split out from the AI review deliberately: these are arithmetic, so they are
 * instant, free, exact, and available from the first day. Nothing here is an
 * interpretation — that is the other section's job.
 */
export async function getKnownFacts(
  userId: string,
  today: IsoDate,
  targetKcal: number,
  windowDays = 30,
): Promise<KnownFacts> {
  /**
   * Averages run to YESTERDAY, never today.
   *
   * Today is half-eaten. Including it drags every average down and makes
   * "1,405 cal a day" read as a habit when it is really a habit plus one
   * unfinished morning. Days-on-target has the same problem: a day cannot be
   * judged against a target it has not finished spending.
   */
  const end = isoDateToUtc(today);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));

  const [entries, water, weights, todayCount] = await Promise.all([
    prisma.entry.findMany({
      where: { userId, localDate: { gte: start, lte: end } },
      include: { items: true },
    }),
    prisma.waterLog.groupBy({
      by: ["localDate"],
      where: { userId, localDate: { gte: start, lte: end } },
      _sum: { ml: true },
    }),
    // Weight is a point measurement, not a daily total, so today's weigh-in is
    // perfectly valid and stays in the trend.
    prisma.weightLog.findMany({
      where: { userId },
      orderBy: { localDate: "asc" },
    }),
    prisma.entry.count({ where: { userId, localDate: isoDateToUtc(today) } }),
  ]);

  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = utcToIsoDate(e.localDate);
    const l = byDay.get(k);
    if (l) l.push(e);
    else byDay.set(k, [e]);
  }

  const items = entries.flatMap((e) => e.items);
  const daysTracked = byDay.size;
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const dailyKcal = [...byDay.values()].map((es) =>
    es.flatMap((e) => e.items).reduce((s, i) => s + i.kcal, 0),
  );

  const mealsOut = entries.filter((e) => e.restaurantName !== null).length;
  const daysWithEatingOut = new Set(
    entries
      .filter((e) => e.restaurantName !== null)
      .map((e) => utcToIsoDate(e.localDate)),
  ).size;

  const totalKcal = items.reduce((s, i) => s + i.kcal, 0);
  const ultraKcal = items
    .filter((i) => i.processedLevel === 4)
    .reduce((s, i) => s + i.kcal, 0);

  /**
   * Weight trend by least squares over (days, kg).
   *
   * A fit rather than first-minus-last: daily weight swings a kilo on water
   * alone, so two endpoints can show a gain during a genuine loss. Needs at
   * least three weigh-ins spanning a week to mean anything.
   */
  let ratePerWeekKg: number | null = null;
  if (weights.length >= 3) {
    const t0 = weights[0].localDate.getTime();
    const xs = weights.map((w) => (w.localDate.getTime() - t0) / 86400000);
    const ys = weights.map((w) => w.weightKg);
    const spanDays = xs[xs.length - 1];
    if (spanDays >= 7) {
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) ** 2;
      }
      if (den > 0) ratePerWeekKg = Math.round((num / den) * 7 * 100) / 100;
    }
  }

  return {
    windowDays,
    daysTracked,
    through: daysTracked > 0 ? utcToIsoDate(end) : null,
    todayExcluded: todayCount > 0,
    avgKcal: mean(dailyKcal) === null ? null : Math.round(mean(dailyKcal)!),
    avgProtein: daysTracked
      ? Math.round(items.reduce((s, i) => s + i.protein, 0) / daysTracked)
      : null,
    avgFiber: daysTracked
      ? Math.round(items.reduce((s, i) => s + (i.fiber ?? 0), 0) / daysTracked)
      : null,
    avgMealsPerDay: daysTracked
      ? Math.round((entries.length / daysTracked) * 10) / 10
      : null,
    avgWaterMl: water.length
      ? Math.round(water.reduce((s, w) => s + (w._sum.ml ?? 0), 0) / water.length)
      : null,
    mealsOut,
    totalMeals: entries.length,
    eatingOutPct: entries.length ? Math.round((mealsOut / entries.length) * 100) : null,
    daysWithEatingOut,
    ultraProcessedPct:
      totalKcal > 0 ? Math.round((ultraKcal / totalKcal) * 100) : null,
    daysOnTarget: dailyKcal.filter(
      (k) => Math.abs(k - targetKcal) / targetKcal <= 0.1,
    ).length,
    targetKcal,
    weight: {
      startKg: weights[0]?.weightKg ?? null,
      latestKg: weights[weights.length - 1]?.weightKg ?? null,
      changeKg:
        weights.length >= 2
          ? Math.round(
              (weights[weights.length - 1].weightKg - weights[0].weightKg) * 10,
            ) / 10
          : null,
      ratePerWeekKg,
      weighIns: weights.length,
    },
  };
}
