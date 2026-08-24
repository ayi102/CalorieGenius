/**
 * The shape of a weekly insight report.
 *
 * Handed to the model via zodOutputFormat, so this schema is simultaneously the
 * validation and the specification. Field descriptions steer the output; keep
 * them concrete.
 */

import { z } from "zod";

export const ObservationSchema = z.object({
  headline: z
    .string()
    .describe("One short sentence stating a pattern you actually saw in the data."),
  detail: z
    .string()
    .describe(
      "One or two sentences with the specific numbers behind it. Cite real figures from the summary, never invented ones.",
    ),
  tone: z
    .enum(["win", "watch", "neutral"])
    .describe(
      "'win' for something going well and worth keeping, 'watch' for something working against the goal, 'neutral' for a plain fact.",
    ),
});

export const SwapSchema = z.object({
  from: z.string().describe("A food she actually logged, named as she logged it."),
  to: z.string().describe("A realistic alternative — not an aspirational one."),
  why: z
    .string()
    .describe(
      "One sentence with the concrete difference, e.g. 'saves about 140 cal and adds 4 g of fiber'.",
    ),
});

export const TipSchema = z.object({
  tip: z.string().describe("One specific action to try this week."),
  because: z
    .string()
    .describe("The pattern in her data that prompted it — reference real numbers."),
});

export const InsightReportSchema = z.object({
  summary: z
    .string()
    .describe(
      "Two or three sentences summing up the week honestly. Lead with what went well if anything did.",
    ),
  observations: z
    .array(ObservationSchema)
    .describe("Two to four patterns worth naming."),
  swaps: z
    .array(SwapSchema)
    .describe(
      "Up to three realistic substitutions from foods she actually ate. Empty if nothing is worth swapping.",
    ),
  tips: z.array(TipSchema).describe("Two or three specific actions for next week."),
  /** Kept short on purpose — a wall of text does not get read. */
  focus: z
    .string()
    .describe("The single most useful thing to focus on next week, in one sentence."),
});

export type InsightReport = z.infer<typeof InsightReportSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
