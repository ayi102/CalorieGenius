/**
 * Log a realistic day of meals for the seeded dev user.
 *
 * Useful for exercising the score, the day view, and later the month heatmap
 * without typing four meals by hand. NOT idempotent in cost: it runs real parses
 * (~4 calls, roughly 8 cents), though repeats are free once cached.
 *
 *   npx tsx scripts/seed-demo-day.ts
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveEntry } from "../src/lib/nutrition/resolve";
import { toLocalDate, guessMealType } from "../src/lib/time";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const TZ = "America/New_York";
const USER = "dev-alice";

/** Build a UTC instant for a given local wall-clock time today in TZ. */
function atLocalHour(h: number, m = 0): Date {
  const now = new Date();
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // EDT in August is UTC-4.
  return new Date(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-04:00`);
}

const MEALS: [string, Date][] = [
  ["2 scrambled eggs and a slice of whole wheat toast with butter", atLocalHour(8, 0)],
  ["grilled chicken breast with a cup of white rice and steamed broccoli", atLocalHour(12, 30)],
  ["greek yogurt with blueberries and honey", atLocalHour(15, 30)],
  ["salmon fillet with roasted potatoes and a glass of red wine", atLocalHour(19, 0)],
];

async function main() {
  await prisma.entry.deleteMany({ where: { userId: USER } });
  for (const [text, eatenAt] of MEALS) {
    const out = await resolveEntry(USER, TZ, text, { eatenAt });
    await prisma.entry.create({
      data: {
        userId: USER,
        eatenAt,
        localDate: toLocalDate(eatenAt, TZ),
        mealType: guessMealType(eatenAt, TZ),
        source: "text",
        rawText: text,
        items: {
          create: out.items.map((i) => ({
            name: i.name, brand: i.brand, quantity: i.quantity, unit: i.unit, grams: i.grams,
            kcal: i.nutrition.kcal, protein: i.nutrition.protein, carbs: i.nutrition.carbs,
            fat: i.nutrition.fat, fiber: i.nutrition.fiber, sugar: i.nutrition.sugar,
            sodium: i.nutrition.sodium, foodGroup: i.foodGroup as never,
            processedLevel: i.processedLevel, nutritionSource: i.nutritionSource as never,
            confidence: i.confidence, usdaFdcId: i.usdaFdcId, foodItemId: i.foodItemId,
          })),
        },
      },
    });
    const grounded = out.items.filter((i) => i.nutritionSource === "usda").length;
    console.log(`  ${grounded}/${out.items.length} usda-grounded  "${text.slice(0, 46)}…"`);
  }
  const n = await prisma.entryItem.count({ where: { entry: { userId: USER } } });
  console.log(`\n${MEALS.length} entries, ${n} items.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
