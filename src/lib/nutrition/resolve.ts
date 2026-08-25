/**
 * resolveEntry — the core loop.
 *
 *   raw text -> [ParseCache] -> parse -> ground each item -> GroundedItem[]
 *
 * Also the enforcement point for the per-user daily parse cap. The cap is
 * checked and the meter incremented BEFORE the provider call, so a crash or a
 * retry storm cannot spend credits without being counted.
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { toLocalDate } from "@/lib/time";
import { hashEntryText } from "./normalize";
import { estimateCostCents, getParser } from "./parse";
import { groundItem, type GroundedItem } from "./ground";
import { ParsedMealSchema, type ParseContext, type ParsedMeal } from "./types";

export interface ResolveOutcome {
  items: GroundedItem[];
  /** Short human title for the card, e.g. "Homemade Coffee". */
  mealName: string;
  restaurantName: string | null;
  /** The parser's note about assumptions, for display. */
  note: string;
  isFood: boolean;
  cached: boolean;
  usage: { parsesUsed: number; parsesRemaining: number };
}

export class ParseLimitError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `Daily parse limit reached (${used}/${limit}). Add the entry manually, or raise DAILY_PARSE_LIMIT.`,
    );
    this.name = "ParseLimitError";
  }
}

/**
 * Resolve free text into grounded items.
 *
 * `userId` and `timezone` come from the session, never from the client — the
 * meter must be keyed to the real user, and the local date decides which day's
 * quota is being spent.
 */
export async function resolveEntry(
  userId: string,
  timezone: string,
  rawText: string,
  options: {
    eatenAt?: Date;
    restaurantName?: string | null;
    imageBase64?: string;
    imageMediaType?: "image/jpeg" | "image/png" | "image/webp";
  } = {},
): Promise<ResolveOutcome> {
  const text = rawText.trim();
  if (text === "" && !options.imageBase64) {
    throw new Error("Nothing to parse.");
  }

  const eatenAt = options.eatenAt ?? new Date();
  const localDate = toLocalDate(eatenAt, timezone);
  const limit = env.dailyParseLimit();

  const parser = getParser();
  const model = env.anthropicModel();

  // --- ParseCache. Photos are never cached: two images are never byte-identical
  // in a way that makes text hashing meaningful. ---
  const canCache = !options.imageBase64 && text !== "";
  const textHash = canCache
    ? hashEntryText(
        options.restaurantName ? `${options.restaurantName}|${text}` : text,
        model,
      )
    : null;

  let meal: ParsedMeal | null = null;
  let cached = false;

  if (textHash) {
    const hit = await prisma.parseCache.findUnique({ where: { textHash } });
    if (hit) {
      // Re-validate rather than trusting stored JSON: the schema may have changed
      // since it was written, and a shape mismatch here would surface as a
      // confusing error much further downstream.
      const parsed = ParsedMealSchema.safeParse(hit.result);
      if (parsed.success) {
        meal = parsed.data;
        cached = true;
        await prisma.parseCache.update({
          where: { textHash },
          data: { hitCount: { increment: 1 } },
        });
      } else {
        // Stale shape — drop it so the next call repopulates.
        await prisma.parseCache.delete({ where: { textHash } }).catch(() => {});
      }
    }
  }

  // --- Quota, checked only when a real call is about to happen. A cache hit
  // costs nothing and must not consume quota. ---
  const usageRow = await prisma.parseUsage.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
  const used = usageRow?.parseCount ?? 0;

  if (!meal) {
    if (used >= limit) throw new ParseLimitError(used, limit);

    const context: ParseContext = {
      restaurantName: options.restaurantName ?? null,
      imageBase64: options.imageBase64,
      imageMediaType: options.imageMediaType,
    };

    const result = await parser.parse(text, context);
    meal = result.meal;

    // Count the call and its cost. Incremented after a successful call so a
    // provider outage does not burn the user's quota.
    await prisma.parseUsage.upsert({
      where: { userId_localDate: { userId, localDate } },
      create: {
        userId,
        localDate,
        parseCount: 1,
        estimatedCostCents: estimateCostCents(result.model, result.usage),
      },
      update: {
        parseCount: { increment: 1 },
        estimatedCostCents: {
          increment: estimateCostCents(result.model, result.usage),
        },
      },
    });

    if (textHash) {
      await prisma.parseCache
        .create({ data: { textHash, result: meal, model: result.model } })
        .catch(() => {}); // a lost cache write is not worth failing the entry
    }
  }

  const restaurantName = options.restaurantName ?? meal.restaurantName ?? null;

  // Ground with BOUNDED concurrency rather than all at once.
  //
  // Measured: firing five USDA lookups simultaneously grounded 19/20, while
  // running them one at a time grounded 20/20 — bursts to api.data.gov fail in a
  // correlated way. A small window keeps most of the parallel speed-up without
  // that penalty.
  const items = await mapWithConcurrency(meal.items, 3, (item) =>
    groundItem(userId, item, { restaurantName }),
  );

  const parsesUsed = cached ? used : used + 1;

  return {
    items,
    mealName: meal.mealName?.trim() || text.slice(0, 40),
    restaurantName,
    note: meal.note,
    isFood: meal.isFood,
    cached,
    usage: {
      parsesUsed,
      parsesRemaining: Math.max(0, limit - parsesUsed),
    },
  };
}

/**
 * Map over items with at most `limit` promises in flight, preserving order.
 *
 * Deliberately dependency-free and tiny: workers pull from a shared cursor, so a
 * slow item never blocks the others the way a chunked implementation would.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
