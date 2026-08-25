/**
 * Weekly insight generation.
 *
 * One model call per user per week, cached in the Insight table. The week's
 * numbers are computed in SQL and handed over as a summary — the model's job is
 * to interpret, not to do arithmetic it would do worse.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isoDateToUtc, type IsoDate } from "@/lib/time";
import { InsightReportSchema, type InsightReport } from "./types";
import { buildWeekSummary, type WeekSummary } from "./aggregate";
import type { Targets } from "@/lib/scoring";

/**
 * The system prompt. Long, stable, and cached — same discipline as the parser.
 *
 * The hard part of this feature is not generating advice, it is generating
 * advice that is SPECIFIC to what she actually ate. Generic nutrition tips are
 * worthless and instantly recognisable as filler, so most of this prompt is
 * about grounding every claim in her real numbers.
 */
const INSIGHT_SYSTEM_PROMPT = `You write a short weekly review for someone tracking what they eat.

You are given a computed summary of their week — real figures from their own log.
Your job is to interpret it usefully, not to lecture.

## The rule that matters most

**Every claim must be grounded in the numbers you were given.** Cite real
figures. Name foods they actually logged, using their own words for them. If the
summary does not support a claim, do not make it.

Generic advice ("drink more water", "eat whole foods") is worthless — they could
get that anywhere. What they cannot get anywhere else is someone looking at their
specific week. If you find yourself writing something that would be true for
anyone, delete it and find something in the data instead.

## Tone

Talk like a knowledgeable friend, not a coach or an app. No exclamation marks, no
cheerleading, no shame. If the week went badly, say so plainly and move to what
would help. If it went well, say that first — people abandon trackers that only
ever criticise.

Never moralise about food. There are no "bad" or "clean" foods, only foods that
fit the goal more or less well.

## Swaps

Suggest substitutions only from foods they ACTUALLY logged, and only realistic
ones. "Swap your soda for water" is fine if they logged soda. "Swap your pizza
for a quinoa bowl" is not — nobody does that.

Give the concrete difference: "saves about 140 cal and adds 4 g of fiber". If
nothing is worth swapping, return an empty list rather than inventing one.

## Reading the summary

- \`processedMean\` is a calorie-weighted NOVA level from 1 (whole food) to 4
  (ultra-processed). Above ~3 means most of their calories came from
  ultra-processed food.
- \`daysOver\` / \`daysUnder\` count days more than 15% either side of target.
  Consistent undereating is worth flagging, not praising — it usually predicts a
  rebound.
- \`lateMeals\` counts meals after 21:00.
- \`daysTracked\` vs \`daysInPeriod\` matters: if they only logged three days,
  say so, and be careful about drawing conclusions from a partial week.
- A \`weight.changeKg\` over a single week is mostly water and noise. Do not
  celebrate or catastrophise it; a week is too short to read a trend from.

## Safety

You are not a clinician. Do not diagnose, do not suggest a medical intervention,
and do not recommend intakes below roughly 1200 cal/day for women or 1500 for
men. If their logged intake is consistently very low, treat that as a concern to
raise gently rather than an achievement.

## Length

Short. The summary is two or three sentences, each observation one or two, each
tip one. A wall of text does not get read.`;

export interface GenerateOptions {
  userId: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  timezone: string;
  targets: Targets;
  goal: string;
  /** Regenerate even if a cached report exists. */
  force?: boolean;
}

export interface InsightResult {
  report: InsightReport;
  summary: WeekSummary;
  cached: boolean;
  generatedAt: Date;
}

/** Not enough data to say anything honest. */
export class NotEnoughDataError extends Error {
  constructor(readonly daysTracked: number) {
    super(
      `Only ${daysTracked} ${daysTracked === 1 ? "day" : "days"} logged this week — log a few more and there'll be something worth reviewing.`,
    );
    this.name = "NotEnoughDataError";
  }
}

/** Below this a "review" would be guesswork dressed up as analysis. */
const MIN_DAYS = 3;

export async function generateWeeklyInsight(
  options: GenerateOptions,
): Promise<InsightResult> {
  const { userId, periodStart, periodEnd, timezone, targets, goal } = options;
  const model = env.anthropicModel();

  const summary = await buildWeekSummary(
    userId,
    periodStart,
    periodEnd,
    timezone,
    targets,
    goal,
  );

  if (summary.daysTracked < MIN_DAYS) {
    throw new NotEnoughDataError(summary.daysTracked);
  }

  const start = isoDateToUtc(periodStart);

  if (!options.force) {
    const cached = await prisma.insight.findUnique({
      where: { userId_kind_periodStart: { userId, kind: "weekly", periodStart: start } },
    });
    if (cached) {
      // Re-validate rather than trusting stored JSON: the schema may have moved
      // since it was written.
      const parsed = InsightReportSchema.safeParse(cached.content);
      if (parsed.success) {
        return {
          report: parsed.data,
          summary,
          cached: true,
          generatedAt: cached.generatedAt,
        };
      }
      await prisma.insight
        .delete({ where: { id: cached.id } })
        .catch(() => {});
    }
  }

  const client = new Anthropic();
  const response = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: [
      {
        type: "text",
        text: INSIGHT_SYSTEM_PROMPT,
        // Stable across every user and every week, so it caches.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is this person's week. Their goal is to ${goal === "lose" ? "lose weight" : goal === "gain" ? "gain weight" : "maintain their weight"}.\n\n${JSON.stringify(summary, null, 2)}`,
      },
    ],
    thinking: { type: "adaptive" },
    output_config: {
      // Interpretation over a table of figures benefits from real reasoning.
      effort: "high",
      format: zodOutputFormat(InsightReportSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error(
      `The model returned no valid report (stop_reason: ${response.stop_reason}).`,
    );
  }

  const report = response.parsed_output;

  await prisma.insight
    .upsert({
      where: { userId_kind_periodStart: { userId, kind: "weekly", periodStart: start } },
      update: {
        content: report,
        model,
        generatedAt: new Date(),
        periodEnd: isoDateToUtc(periodEnd),
      },
      create: {
        userId,
        kind: "weekly",
        periodStart: start,
        periodEnd: isoDateToUtc(periodEnd),
        content: report,
        model,
      },
    })
    .catch(() => {}); // a failed cache write must not lose the report

  return { report, summary, cached: false, generatedAt: new Date() };
}
