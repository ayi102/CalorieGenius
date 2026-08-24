/**
 * Turn a week of rows into a compact summary for the model.
 *
 * Aggregating here rather than sending raw entries is the important decision:
 * a week of meals is thousands of tokens and the model would have to do
 * arithmetic it will do worse than SQL. Sending computed figures makes the call
 * cheaper, faster, and far less likely to state a wrong number.
 */

import { prisma } from "@/lib/prisma";
import { isoDateToUtc, utcToIsoDate, toLocalMinutes, type IsoDate } from "@/lib/time";
import type { Targets } from "@/lib/scoring";

export interface WeekSummary {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  daysTracked: number;
  daysInPeriod: number;
  targets: { kcal: number; protein: number };
  averages: {
    kcal: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    mealsPerDay: number | null;
    waterMl: number | null;
  };
  /** Share of calories by food group, biggest first. */
  foodGroups: { group: string; kcal: number; sharePct: number }[];
  /** Calorie-weighted mean processing level, 1 (whole) to 4 (ultra-processed). */
  processedMean: number | null;
  /** The foods she ate most, with how often and what they cost her. */
  topFoods: { name: string; times: number; kcalEach: number; processedLevel: number }[];
  /** Restaurants, if any. */
  restaurants: { name: string; times: number }[];
  /** Meals after 21:00 local — the late-eating signal. */
  lateMeals: number;
  /** Days where intake exceeded the target by more than 15%. */
  daysOver: number;
  daysUnder: number;
  weight: { startKg: number | null; endKg: number | null; changeKg: number | null };
  goal: string;
}

export async function buildWeekSummary(
  userId: string,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  timezone: string,
  targets: Targets,
  goal: string,
): Promise<WeekSummary> {
  const start = isoDateToUtc(periodStart);
  const end = isoDateToUtc(periodEnd);

  const [entries, water, weights] = await Promise.all([
    prisma.entry.findMany({
      where: { userId, localDate: { gte: start, lte: end } },
      include: { items: true },
      orderBy: { eatenAt: "asc" },
    }),
    prisma.waterLog.groupBy({
      by: ["localDate"],
      where: { userId, localDate: { gte: start, lte: end } },
      _sum: { ml: true },
    }),
    prisma.weightLog.findMany({
      where: { userId, localDate: { gte: start, lte: end } },
      orderBy: { localDate: "asc" },
    }),
  ]);

  const items = entries.flatMap((e) => e.items);
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = utcToIsoDate(e.localDate);
    const l = byDay.get(k);
    if (l) l.push(e);
    else byDay.set(k, [e]);
  }

  const daysInPeriod =
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const daysTracked = byDay.size;

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  const dailyKcal = [...byDay.values()].map((es) =>
    es.flatMap((e) => e.items).reduce((s, i) => s + i.kcal, 0),
  );

  // --- Food groups ---
  const groupKcal = new Map<string, number>();
  for (const i of items) {
    groupKcal.set(i.foodGroup, (groupKcal.get(i.foodGroup) ?? 0) + i.kcal);
  }
  const totalKcal = [...groupKcal.values()].reduce((a, b) => a + b, 0);

  // --- Most-eaten foods, keyed loosely so "eggs" and "Eggs" are one thing ---
  const foodCount = new Map<string, { times: number; kcal: number; level: number }>();
  for (const i of items) {
    const k = i.name.trim().toLowerCase();
    const prev = foodCount.get(k) ?? { times: 0, kcal: 0, level: i.processedLevel };
    foodCount.set(k, {
      times: prev.times + 1,
      kcal: prev.kcal + i.kcal,
      level: i.processedLevel,
    });
  }

  const restaurantCount = new Map<string, number>();
  for (const e of entries) {
    if (e.restaurantName) {
      restaurantCount.set(
        e.restaurantName,
        (restaurantCount.get(e.restaurantName) ?? 0) + 1,
      );
    }
  }

  const LATE = 21 * 60;
  const lateMeals = entries.filter(
    (e) => toLocalMinutes(e.eatenAt, timezone) >= LATE,
  ).length;

  return {
    periodStart,
    periodEnd,
    daysTracked,
    daysInPeriod,
    targets: { kcal: targets.kcal, protein: targets.protein },
    averages: {
      kcal: mean(dailyKcal) === null ? null : Math.round(mean(dailyKcal)!),
      protein: daysTracked
        ? Math.round(items.reduce((s, i) => s + i.protein, 0) / daysTracked)
        : null,
      carbs: daysTracked
        ? Math.round(items.reduce((s, i) => s + i.carbs, 0) / daysTracked)
        : null,
      fat: daysTracked
        ? Math.round(items.reduce((s, i) => s + i.fat, 0) / daysTracked)
        : null,
      fiber: daysTracked
        ? Math.round(items.reduce((s, i) => s + (i.fiber ?? 0), 0) / daysTracked)
        : null,
      mealsPerDay: daysTracked
        ? Math.round((entries.length / daysTracked) * 10) / 10
        : null,
      waterMl: water.length
        ? Math.round(
            water.reduce((s, w) => s + (w._sum.ml ?? 0), 0) / water.length,
          )
        : null,
    },
    foodGroups: [...groupKcal.entries()]
      .map(([group, kcal]) => ({
        group,
        kcal: Math.round(kcal),
        sharePct: totalKcal > 0 ? Math.round((kcal / totalKcal) * 100) : 0,
      }))
      .sort((a, b) => b.kcal - a.kcal),
    processedMean:
      totalKcal > 0
        ? Math.round(
            (items.reduce((s, i) => s + i.processedLevel * i.kcal, 0) / totalKcal) * 10,
          ) / 10
        : null,
    topFoods: [...foodCount.entries()]
      .sort((a, b) => b[1].times - a[1].times)
      .slice(0, 10)
      .map(([name, v]) => ({
        name,
        times: v.times,
        kcalEach: Math.round(v.kcal / v.times),
        processedLevel: v.level,
      })),
    restaurants: [...restaurantCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, times]) => ({ name, times })),
    lateMeals,
    daysOver: dailyKcal.filter((k) => k > targets.kcal * 1.15).length,
    daysUnder: dailyKcal.filter((k) => k < targets.kcal * 0.85).length,
    weight: {
      startKg: weights[0]?.weightKg ?? null,
      endKg: weights[weights.length - 1]?.weightKg ?? null,
      changeKg:
        weights.length >= 2
          ? Math.round(
              (weights[weights.length - 1].weightKg - weights[0].weightKg) * 10,
            ) / 10
          : null,
    },
    goal,
  };
}
