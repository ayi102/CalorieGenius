/**
 * Pattern insights — the analysis that genuinely needs history.
 *
 * Separate from the weekly review because the questions are different. A week
 * can tell you whether you hit your calories; it cannot tell you that weekends
 * are consistently your worst days, or which of the foods you already like is
 * worth eating more of. Those need weeks of data, so they get their own window,
 * their own cache entry, and their own minimum.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isoDateToUtc, utcToIsoDate, type IsoDate } from "@/lib/time";

export const PatternReportSchema = z.object({
  summary: z
    .string()
    .describe("Two or three sentences on the habits visible across this whole period."),
  favouriteFoods: z
    .array(
      z.object({
        food: z.string().describe("A food she eats often, named as she logs it."),
        verdict: z
          .enum(["keep", "moderate", "reduce"])
          .describe("Whether this habit helps the goal, is fine in moderation, or works against it."),
        why: z.string().describe("One sentence with the numbers behind the verdict."),
      }),
    )
    .describe("Three to five foods she genuinely eats a lot of."),
  eatMore: z
    .array(
      z.object({
        food: z.string().describe("A food SHE ALREADY EATS and likes."),
        why: z
          .string()
          .describe("Why more of it would help — protein, fiber, satiety per calorie."),
      }),
    )
    .describe(
      "Up to three foods already in her rotation worth leaning on. Never suggest something she has never logged.",
    ),
  swaps: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        savingPerWeek: z
          .string()
          .describe('Estimated weekly calorie saving, e.g. "about 900 cal/week".'),
        why: z.string(),
      }),
    )
    .describe("Up to three substitutions, each with an estimated weekly saving."),
  worstDays: z
    .object({
      pattern: z
        .string()
        .describe('The day-of-week pattern, e.g. "Weekends run about 500 cal higher".'),
      detail: z.string().describe("The figures behind it."),
    })
    .describe("The day-of-week pattern, or say plainly that there isn't a clear one."),
  eatingOut: z
    .object({
      pattern: z.string().describe("What eating out is costing her, in her own numbers."),
      detail: z.string(),
    })
    .describe("Restaurant habits. Say so if she barely eats out."),
});

export type PatternReport = z.infer<typeof PatternReportSchema>;

const PATTERN_SYSTEM_PROMPT = `You analyse several weeks of someone's food log and report the habits in it.

You are given computed aggregates — real figures from their own log. Interpret
them; do not recompute them.

## Grounding

Every claim must trace to the numbers given. Name foods using their own words.
Never invent a food they have not logged — in particular, "eat more of" must only
ever name something already in their rotation. Suggesting quinoa to someone who
has never logged quinoa is the exact failure that makes this kind of advice
worthless.

## What is actually useful here

A week's review can say "you were over on Tuesday". You are looking at something
longer, so find things a week cannot show:

- Which foods genuinely recur, and whether each helps or hurts the goal.
- Day-of-week patterns. Weekends running high is the classic one, but check
  before asserting it — if the data does not show it, say there is no clear
  pattern rather than inventing one.
- What eating out costs, in calories and frequency.
- Substitutions worth making, each with a realistic WEEKLY saving. Weekly is the
  useful unit: "saves 140 cal" sounds trivial, "about 900 cal a week" does not.
- Foods she already likes that are worth leaning on. This is the most useful
  section and the one most often filled with generic advice — resist that.

## Tone

A knowledgeable friend, not a coach. No cheerleading, no shame, no moralising
about food. If a habit is working, say so first.

## Safety

Not a clinician. No diagnoses, no medical suggestions, and never recommend
intakes below roughly 1200 cal/day for women or 1500 for men. Consistent
undereating is a concern to raise gently, never an achievement to praise.`;

export interface PatternSummary {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  daysTracked: number;
  windowDays: number;
  targets: { kcal: number; protein: number };
  goal: string;
  /** Averages per day of the week, to expose weekend effects. */
  byWeekday: {
    weekday: string;
    daysTracked: number;
    avgKcal: number | null;
    avgMeals: number | null;
    mealsOut: number;
  }[];
  topFoods: {
    name: string;
    times: number;
    totalKcal: number;
    kcalEach: number;
    processedLevel: number;
    foodGroup: string;
    proteinEach: number;
    fiberEach: number;
  }[];
  restaurants: { name: string; times: number; avgKcal: number }[];
  eatingOut: { meals: number; totalMeals: number; avgKcalOut: number | null; avgKcalIn: number | null };
  weight: { changeKg: number | null; ratePerWeekKg: number | null; weighIns: number };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function buildPatternSummary(
  userId: string,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  targets: { kcal: number; protein: number },
  goal: string,
): Promise<PatternSummary> {
  const start = isoDateToUtc(periodStart);
  const end = isoDateToUtc(periodEnd);

  const [entries, weights] = await Promise.all([
    prisma.entry.findMany({
      where: { userId, localDate: { gte: start, lte: end } },
      include: { items: true },
    }),
    prisma.weightLog.findMany({
      where: { userId, localDate: { gte: start, lte: end } },
      orderBy: { localDate: "asc" },
    }),
  ]);

  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = utcToIsoDate(e.localDate);
    const l = byDay.get(k);
    if (l) l.push(e);
    else byDay.set(k, [e]);
  }

  // --- weekday breakdown ---
  const dayBuckets = new Map<number, { kcal: number[]; meals: number[]; out: number }>();
  for (const [iso, es] of byDay) {
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    const b = dayBuckets.get(dow) ?? { kcal: [], meals: [], out: 0 };
    b.kcal.push(es.flatMap((e) => e.items).reduce((s, i) => s + i.kcal, 0));
    b.meals.push(es.length);
    b.out += es.filter((e) => e.restaurantName !== null).length;
    dayBuckets.set(dow, b);
  }
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

  const byWeekday = WEEKDAYS.map((weekday, dow) => {
    const b = dayBuckets.get(dow);
    return {
      weekday,
      daysTracked: b?.kcal.length ?? 0,
      avgKcal: b ? mean(b.kcal) : null,
      avgMeals: b ? mean(b.meals) : null,
      mealsOut: b?.out ?? 0,
    };
  });

  // --- foods ---
  const foodAgg = new Map<
    string,
    { times: number; kcal: number; protein: number; fiber: number; level: number; group: string }
  >();
  for (const i of entries.flatMap((e) => e.items)) {
    const k = i.name.trim().toLowerCase();
    const prev =
      foodAgg.get(k) ??
      { times: 0, kcal: 0, protein: 0, fiber: 0, level: i.processedLevel, group: i.foodGroup };
    foodAgg.set(k, {
      times: prev.times + 1,
      kcal: prev.kcal + i.kcal,
      protein: prev.protein + i.protein,
      fiber: prev.fiber + (i.fiber ?? 0),
      level: i.processedLevel,
      group: i.foodGroup,
    });
  }

  // --- eating out ---
  const outEntries = entries.filter((e) => e.restaurantName !== null);
  const inEntries = entries.filter((e) => e.restaurantName === null);
  const kcalOf = (es: typeof entries) =>
    es.map((e) => e.items.reduce((s, i) => s + i.kcal, 0));

  const restAgg = new Map<string, { times: number; kcal: number }>();
  for (const e of outEntries) {
    const k = e.restaurantName!;
    const prev = restAgg.get(k) ?? { times: 0, kcal: 0 };
    restAgg.set(k, {
      times: prev.times + 1,
      kcal: prev.kcal + e.items.reduce((s, i) => s + i.kcal, 0),
    });
  }

  return {
    periodStart,
    periodEnd,
    daysTracked: byDay.size,
    windowDays: Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    targets,
    goal,
    byWeekday,
    topFoods: [...foodAgg.entries()]
      .sort((a, b) => b[1].times - a[1].times)
      .slice(0, 15)
      .map(([name, v]) => ({
        name,
        times: v.times,
        totalKcal: Math.round(v.kcal),
        kcalEach: Math.round(v.kcal / v.times),
        processedLevel: v.level,
        foodGroup: v.group,
        proteinEach: Math.round(v.protein / v.times),
        fiberEach: Math.round((v.fiber / v.times) * 10) / 10,
      })),
    restaurants: [...restAgg.entries()]
      .sort((a, b) => b[1].times - a[1].times)
      .map(([name, v]) => ({
        name,
        times: v.times,
        avgKcal: Math.round(v.kcal / v.times),
      })),
    eatingOut: {
      meals: outEntries.length,
      totalMeals: entries.length,
      avgKcalOut: mean(kcalOf(outEntries)),
      avgKcalIn: mean(kcalOf(inEntries)),
    },
    weight: {
      changeKg:
        weights.length >= 2
          ? Math.round(
              (weights[weights.length - 1].weightKg - weights[0].weightKg) * 10,
            ) / 10
          : null,
      ratePerWeekKg: null,
      weighIns: weights.length,
    },
  };
}

/** Below this, "patterns" would be a single week wearing a longer name. */
export const PATTERN_MIN_DAYS = 14;

export class NotEnoughPatternDataError extends Error {
  constructor(readonly daysTracked: number) {
    super(
      `Pattern insights need about ${PATTERN_MIN_DAYS} days of logs — there are ${daysTracked} so far. Keep logging and this fills in.`,
    );
    this.name = "NotEnoughPatternDataError";
  }
}

export async function generatePatternInsight(options: {
  userId: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  timezone: string;
  targets: { kcal: number; protein: number };
  goal: string;
  force?: boolean;
}): Promise<{ report: PatternReport; cached: boolean; generatedAt: Date; daysTracked: number }> {
  const { userId, periodStart, periodEnd, targets, goal } = options;
  const model = env.anthropicModel();

  // The weekday split reads Entry.localDate, which is already in her zone, so
  // no timezone argument is needed here.
  const summary = await buildPatternSummary(
    userId,
    periodStart,
    periodEnd,
    targets,
    goal,
  );

  if (summary.daysTracked < PATTERN_MIN_DAYS) {
    throw new NotEnoughPatternDataError(summary.daysTracked);
  }

  const start = isoDateToUtc(periodStart);

  if (!options.force) {
    const cached = await prisma.insight.findUnique({
      where: { userId_kind_periodStart: { userId, kind: "patterns", periodStart: start } },
    });
    if (cached) {
      const parsed = PatternReportSchema.safeParse(cached.content);
      if (parsed.success) {
        return {
          report: parsed.data,
          cached: true,
          generatedAt: cached.generatedAt,
          daysTracked: summary.daysTracked,
        };
      }
      await prisma.insight.delete({ where: { id: cached.id } }).catch(() => {});
    }
  }

  const client = new Anthropic();
  const response = await client.messages.parse({
    model,
    max_tokens: 12000,
    system: [
      { type: "text", text: PATTERN_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `Their goal is to ${goal === "lose" ? "lose weight" : goal === "gain" ? "gain weight" : "maintain their weight"}.\n\n${JSON.stringify(summary, null, 2)}`,
      },
    ],
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(PatternReportSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`No valid report (stop_reason: ${response.stop_reason}).`);
  }

  const report = response.parsed_output;

  await prisma.insight
    .upsert({
      where: { userId_kind_periodStart: { userId, kind: "patterns", periodStart: start } },
      update: { content: report, model, generatedAt: new Date(), periodEnd: isoDateToUtc(periodEnd) },
      create: {
        userId,
        kind: "patterns",
        periodStart: start,
        periodEnd: isoDateToUtc(periodEnd),
        content: report,
        model,
      },
    })
    .catch(() => {});

  return { report, cached: false, generatedAt: new Date(), daysTracked: summary.daysTracked };
}
