/**
 * Assertions for src/lib/scoring.ts. Exits non-zero on any failure.
 *
 * There is no test framework in this project; this script is the check. Run it
 * after ANY change to scoring.ts:
 *
 *   npm run check:scoring
 */

import {
  ageFrom,
  computeDayScore,
  computeMealScore,
  computeTargets,
  scoreBand,
  type ScoreItem,
  type TargetInput,
} from "../src/lib/scoring";
import { isWithinWindow, minutesOutsideWindow, windowLength } from "../src/lib/time";
import {
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatWeight,
  kgToLb,
  lbToKg,
  flOzToMl,
  formatVolume,
  mlToFlOz,
  waterTarget,
} from "../src/lib/units";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown, tol = 0) {
  checks++;
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= tol
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// computeTargets — Mifflin–St Jeor, hand-computed
// ---------------------------------------------------------------------------
section("computeTargets");

const baseProfile: TargetInput = {
  sex: "male",
  ageYears: 35,
  heightCm: 180,
  weightKg: 80,
  activityLevel: "moderate",
  goal: "maintain",
  calorieTargetOverride: null,
  proteinTargetOverride: null,
};

// male: 10*80 + 6.25*180 - 5*35 + 5 = 800 + 1125 - 175 + 5 = 1755
check("male BMR", computeTargets(baseProfile).bmr, 1755);
// TDEE = 1755 * 1.55 = 2720.25 -> 2720
check("moderate TDEE", computeTargets(baseProfile).tdee, 2720);
// maintain = TDEE
check("maintain kcal", computeTargets(baseProfile).kcal, 2720);
// protein = 80 * 1.6 = 128
check("protein target", computeTargets(baseProfile).protein, 128);

// female: 10*65 + 6.25*165 - 5*30 - 161 = 650 + 1031.25 - 150 - 161 = 1370.25
check(
  "female BMR",
  computeTargets({
    ...baseProfile,
    sex: "female",
    ageYears: 30,
    heightCm: 165,
    weightKg: 65,
  }).bmr,
  1370,
);

// lose = TDEE * 0.8 = 2720.25 * 0.8 = 2176.2 -> 2176
check(
  "lose applies -20%",
  computeTargets({ ...baseProfile, goal: "lose" }).kcal,
  2176,
);
// gain = TDEE * 1.1 = 2992.275 -> 2992
check(
  "gain applies +10%",
  computeTargets({ ...baseProfile, goal: "gain" }).kcal,
  2992,
);
// sedentary TDEE = 1755 * 1.2 = 2106
check(
  "sedentary multiplier",
  computeTargets({ ...baseProfile, activityLevel: "sedentary" }).tdee,
  2106,
);

// Overrides must win outright.
const overridden = computeTargets({
  ...baseProfile,
  calorieTargetOverride: 1800,
  proteinTargetOverride: 150,
});
check("override kcal wins", overridden.kcal, 1800);
check("override protein wins", overridden.protein, 150);

// An incomplete profile must not fabricate a personalized target.
const incomplete = computeTargets({ ...baseProfile, weightKg: null });
check("incomplete profile is not 'computed'", incomplete.computed, false);
check("incomplete profile has no BMR", incomplete.bmr, null);

check("ageFrom before birthday", ageFrom(new Date(Date.UTC(1990, 5, 15)), new Date(Date.UTC(2026, 5, 14))), 35);
check("ageFrom on birthday", ageFrom(new Date(Date.UTC(1990, 5, 15)), new Date(Date.UTC(2026, 5, 15))), 36);

// ---------------------------------------------------------------------------
// computeDayScore
// ---------------------------------------------------------------------------
section("computeDayScore");

const targets = { kcal: 2000, protein: 120 };

/** Build n items summing to the given totals, all at one processing level. */
function items(
  kcal: number,
  protein: number,
  processedLevel: number,
  count = 1,
): ScoreItem[] {
  return Array.from({ length: count }, () => ({
    kcal: kcal / count,
    protein: protein / count,
    carbs: 0,
    fat: 0,
    processedLevel,
  }));
}

// An empty day is untracked, NOT a zero. This is the one that poisons month
// averages if it regresses.
check(
  "empty day scores null",
  computeDayScore({ items: [], meals: [], targets, bedtimeMinutes: 1380, goal: "maintain" }),
  null,
);

// A perfect day: on-target calories and protein, whole foods, 4 well-spaced
// meals, nothing late.
const perfect = computeDayScore({
  items: items(2000, 120, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check("perfect day totals 100", perfect.total, 100);
check("perfect day macro total kcal", perfect.totals.kcal, 2000);
check("perfect day meal count", perfect.totals.mealCount, 4);

// Double the calorie target: deviation 100% -> calories component is zero.
const doubled = computeDayScore({
  items: items(4000, 120, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check("2x calories zeroes the calorie component", doubled.components.find((c) => c.key === "calories")!.earned, 0);
check("2x calories keeps the other 60", doubled.total, 60);

// Zero protein.
const noProtein = computeDayScore({
  items: items(2000, 0, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check("no protein zeroes the protein component", noProtein.components.find((c) => c.key === "protein")!.earned, 0);
check("no protein total", noProtein.total, 75);

// Protein overshoot must not exceed the cap.
const proteinOvershoot = computeDayScore({
  items: items(2000, 400, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check("protein is capped, not rewarded", proteinOvershoot.components.find((c) => c.key === "protein")!.earned, 25);

// All ultra-processed -> quality component is zero.
const junk = computeDayScore({
  items: items(2000, 120, 4, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check("all level-4 food zeroes quality", junk.components.find((c) => c.key === "quality")!.earned, 0);

// Calorie weighting: a 100 kcal salad (level 1) plus a 1900 kcal pizza (level 4)
// must score near the pizza, not halfway. Unweighted mean would be 2.5 -> 10 pts.
const weighted = computeDayScore({
  items: [
    { kcal: 100, protein: 5, carbs: 0, fat: 0, processedLevel: 1 },
    { kcal: 1900, protein: 115, carbs: 0, fat: 0, processedLevel: 4 },
  ],
  meals: [{ localMinutes: 780 }, { localMinutes: 1020 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check(
  "quality is calorie-weighted, not item-counted",
  weighted.components.find((c) => c.key === "quality")!.earned,
  1.0,
  0.15,
);

// Late-night eating: a meal 30 min before an 11pm bedtime, and one at 1am.
const lateNight = computeDayScore({
  items: items(2000, 120, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1350 }, { localMinutes: 60 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
const lateTiming = lateNight.components.find((c) => c.key === "timing")!;
check("two late meals zero the late-eating sub-score", lateTiming.earned < 15, true);
check("1am meal counts as late (circular clock)", lateTiming.detail.includes("late meal"), true);

// Weight-loss goal penalizes overshoot harder than the same undershoot.
const overLose = computeDayScore({
  items: items(2400, 120, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "lose",
})!;
const underLose = computeDayScore({
  items: items(1600, 120, 1, 4),
  meals: [{ localMinutes: 480 }, { localMinutes: 780 }, { localMinutes: 1020 }, { localMinutes: 1140 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "lose",
})!;
check(
  "on a loss goal, +20% costs more than -20%",
  overLose.total < underLose.total,
  true,
);

// One meal only: loses frequency and spacing points.
const oneMeal = computeDayScore({
  items: items(2000, 120, 1, 1),
  meals: [{ localMinutes: 780 }],
  targets,
  bedtimeMinutes: 1380,
  goal: "maintain",
})!;
check("single meal loses timing points", oneMeal.components.find((c) => c.key === "timing")!.earned < 10, true);

// Components must always sum to at most 100 and never go negative.
for (const day of [perfect, doubled, noProtein, junk, weighted, lateNight, oneMeal]) {
  const sum = day.components.reduce((s, c) => s + c.earned, 0);
  check(`components sum in range (total ${day.total})`, sum >= 0 && sum <= 100.001, true);
  for (const c of day.components) {
    check(`  ${c.key} within [0, ${c.max}]`, c.earned >= 0 && c.earned <= c.max, true);
  }
}

section("scoreBand");
check("null -> none", scoreBand(null), "none");
check("49 -> poor", scoreBand(49), "poor");
check("69 -> ok", scoreBand(69), "ok");
check("84 -> good", scoreBand(84), "good");
check("100 -> great", scoreBand(100), "great");


// ---------------------------------------------------------------------------
// Unit conversion — round-tripping matters because the DB is metric-only and
// every imperial value the user sees passes through here twice.
// ---------------------------------------------------------------------------
section("units");

check("lb -> kg (150 lb)", Math.round(lbToKg(150) * 100) / 100, 68.04, 0.01);
check("kg -> lb (68.04 kg)", Math.round(kgToLb(68.04)), 150);
check("5'9\" -> cm", Math.round(feetInchesToCm(5, 9) * 10) / 10, 175.3, 0.05);
check("175.3 cm -> 5'9\"", cmToFeetInches(175.3), { feet: 5, inches: 9 });

// The carry case: 179.9 cm is 70.8 inches, which rounds to 71 = 5'11", and
// 182.7 cm is 71.9 -> 72 inches, which MUST carry to 6'0" and not read 5'12".
check("carries 12 inches into a foot", cmToFeetInches(182.7), { feet: 6, inches: 0 });
check("just under the carry", cmToFeetInches(179.9), { feet: 5, inches: 11 });

// Round-trip within display precision, across the plausible human range.
for (const lb of [98, 137, 180, 225, 310]) {
  check(`weight round-trips at ${lb} lb`, Math.round(kgToLb(lbToKg(lb))), lb);
}
for (const [ft, inch] of [[4, 10], [5, 0], [5, 5], [6, 2], [6, 11]] as const) {
  const back = cmToFeetInches(feetInchesToCm(ft, inch));
  check(`height round-trips at ${ft}'${inch}"`, back, { feet: ft, inches: inch });
}

check("formatWeight imperial", formatWeight(62, "imperial"), "137 lb");
check("formatHeight imperial", formatHeight(165, "imperial"), `5'5"`);
check("formatWeight metric", formatWeight(62, "metric"), "62.0 kg");
check("null weight renders as a dash", formatWeight(null, "imperial"), "—");

// ---------------------------------------------------------------------------
// computeMealScore — judged on intrinsic properties, not the day's totals
// ---------------------------------------------------------------------------
section("computeMealScore");

const DAILY = 2000;

/** One item with explicit macros. */
function it(
  kcal: number,
  protein: number,
  processedLevel: number,
  fiber = 0,
): ScoreItem {
  return { kcal, protein, carbs: 0, fat: 0, fiber, processedLevel };
}

check("empty meal scores null", computeMealScore([], "lunch", DAILY), null);

// Grilled chicken + rice + broccoli at ~600 kcal for lunch: whole foods, high
// protein density, real fiber, sensible size.
const goodLunch = computeMealScore(
  [it(257, 54, 1, 0), it(208, 4, 1, 0.6), it(55, 4, 1, 5.1)],
  "lunch",
  DAILY,
)!;
check("balanced whole-food lunch scores high", goodLunch.total >= 85, true);
check("  quality is full", goodLunch.components.find((c) => c.key === "quality")!.earned, 40);
check("  protein is full", goodLunch.components.find((c) => c.key === "protein")!.earned, 30);

// Soda + chips: ultra-processed, no protein, no fiber.
const junkSnack = computeMealScore([it(300, 0, 4, 0), it(250, 2, 4, 0)], "snack", DAILY)!;
check("ultra-processed snack scores low", junkSnack.total <= 20, true);
check("  quality zero", junkSnack.components.find((c) => c.key === "quality")!.earned, 0);
check("  fiber zero", junkSnack.components.find((c) => c.key === "fiber")!.earned, 0);

// Density, not absolute grams: a small and a large meal with the SAME protein
// per calorie must score identically on protein.
const small = computeMealScore([it(300, 24, 1, 4.2)], "breakfast", DAILY)!;
const large = computeMealScore([it(900, 72, 1, 12.6)], "dinner", DAILY)!;
check(
  "protein is scored by density, so meal size does not distort it",
  small.components.find((c) => c.key === "protein")!.earned,
  large.components.find((c) => c.key === "protein")!.earned,
);

// Size is judged against the slot's expected share: 700 kcal is fine for dinner
// (35% of 2000 = 700) and too big for a snack (10% = 200).
const asDinner = computeMealScore([it(700, 40, 1, 8)], "dinner", DAILY)!;
const asSnack = computeMealScore([it(700, 40, 1, 8)], "snack", DAILY)!;
check("700 kcal is right-sized for dinner", asDinner.components.find((c) => c.key === "size")!.earned, 15);
check("the same 700 kcal is oversized for a snack", asSnack.components.find((c) => c.key === "size")!.earned, 0);
check("size is the ONLY difference", asDinner.total - asSnack.total, 15);

// The headline must be derived from the components, never canned — otherwise it
// can drift out of agreement with the breakdown shown beneath it.
check("headline flags the weak component", junkSnack.headline.toLowerCase().includes("weak"), true);
check("strong meal says so", goodLunch.headline, "Strong across the board.");
const lowFiber = computeMealScore([it(500, 45, 1, 0)], "lunch", DAILY)!;
check("low-fiber meal names fiber", lowFiber.headline.includes("fiber"), true);

// The headline is shown right next to the total, so it must never describe a
// weakness on a meal that scored highly — that reads as a contradiction.
for (const m of [goodLunch, small, large, asDinner]) {
  if (m.total >= 90) {
    check(
      `headline claims no weakness at ${m.total}/100`,
      m.headline,
      "Strong across the board.",
    );
  }
}

// Components must stay in range for every shape.
for (const m of [goodLunch, junkSnack, small, large, asDinner, asSnack, lowFiber]) {
  const sum = m.components.reduce((s, c) => s + c.earned, 0);
  check(`meal components sum in range (total ${m.total})`, sum >= 0 && sum <= 100.001, true);
  for (const c of m.components) {
    check(`  meal ${c.key} within [0, ${c.max}]`, c.earned >= 0 && c.earned <= c.max, true);
  }
}

// Fiber is optional on ScoreItem; omitting it must count as zero, not NaN.
const noFiberField = computeMealScore(
  [{ kcal: 400, protein: 20, carbs: 0, fat: 0, processedLevel: 2 }],
  "lunch",
  DAILY,
)!;
check("omitted fiber counts as zero, not NaN", noFiberField.components.find((c) => c.key === "fiber")!.earned, 0);
check("omitted fiber leaves a finite total", Number.isFinite(noFiberField.total), true);

// ---------------------------------------------------------------------------
// Fuzz: the number on screen must equal the sum of the numbers on screen.
//
// The components are rounded to 1dp for display and the total is rounded to a
// whole number, so a user adding up the breakdown must land on the total. This
// sweeps a wide input space looking for any case where it doesn't, or where a
// component escapes its bounds, or where a NaN leaks through.
// ---------------------------------------------------------------------------
section("fuzz: totals reconcile with displayed components");

// Deterministic PRNG (mulberry32) — a fixed seed means a failure is reproducible
// rather than a one-off that vanishes on rerun.
function makeRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260823);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

let dayBad = 0;
let mealBad = 0;
let dayChecked = 0;
let mealChecked = 0;
const failures_seen: string[] = [];

for (let trial = 0; trial < 4000; trial++) {
  const itemCount = 1 + Math.floor(rng() * 8);
  const fuzzItems: ScoreItem[] = Array.from({ length: itemCount }, () => ({
    // Include degenerate values on purpose: zero-calorie drinks and zero-protein
    // foods are real, and both are division hazards.
    kcal: rng() < 0.1 ? 0 : Math.round(rng() * 1200),
    protein: rng() < 0.15 ? 0 : Math.round(rng() * 80),
    carbs: Math.round(rng() * 120),
    fat: Math.round(rng() * 60),
    fiber: rng() < 0.2 ? 0 : Math.round(rng() * 15 * 10) / 10,
    processedLevel: 1 + Math.floor(rng() * 4),
  }));

  const mealCount = 1 + Math.floor(rng() * 7);
  const meals = Array.from({ length: mealCount }, () => ({
    localMinutes: Math.floor(rng() * 1440),
  }));

  const fuzzTargets = {
    kcal: 1200 + Math.floor(rng() * 2000),
    protein: 60 + Math.floor(rng() * 140),
  };
  const goal = pick(["lose", "maintain", "gain"] as const);
  const bedtime = Math.floor(rng() * 1440);

  // --- day ---
  const d = computeDayScore({ items: fuzzItems, meals, targets: fuzzTargets, bedtimeMinutes: bedtime, goal });
  if (d) {
    dayChecked++;
    const sum = d.components.reduce((acc, c) => acc + c.earned, 0);
    const reconciles = Math.round(sum) === d.total;
    const inRange = d.total >= 0 && d.total <= 100;
    const finite =
      Number.isFinite(d.total) && d.components.every((c) => Number.isFinite(c.earned));
    const bounded = d.components.every((c) => c.earned >= 0 && c.earned <= c.max);
    if (!reconciles || !inRange || !finite || !bounded) {
      dayBad++;
      if (failures_seen.length < 3) {
        failures_seen.push(
          `day trial ${trial}: total=${d.total} sum=${sum.toFixed(2)} reconciles=${reconciles} range=${inRange} finite=${finite} bounded=${bounded}`,
        );
      }
    }
  }

  // --- meal ---
  const m = computeMealScore(fuzzItems, pick(["breakfast", "lunch", "dinner", "snack"] as const), fuzzTargets.kcal);
  if (m) {
    mealChecked++;
    const sum = m.components.reduce((acc, c) => acc + c.earned, 0);
    const reconciles = Math.round(sum) === m.total;
    const inRange = m.total >= 0 && m.total <= 100;
    const finite =
      Number.isFinite(m.total) && m.components.every((c) => Number.isFinite(c.earned));
    const bounded = m.components.every((c) => c.earned >= 0 && c.earned <= c.max);
    const hasHeadline = typeof m.headline === "string" && m.headline.length > 0;
    if (!reconciles || !inRange || !finite || !bounded || !hasHeadline) {
      mealBad++;
      if (failures_seen.length < 3) {
        failures_seen.push(
          `meal trial ${trial}: total=${m.total} sum=${sum.toFixed(2)} reconciles=${reconciles} range=${inRange} finite=${finite} bounded=${bounded} headline=${hasHeadline}`,
        );
      }
    }
  }
}

for (const f of failures_seen) console.error(`        ${f}`);
check(`day totals reconcile across ${dayChecked} random days`, dayBad, 0);
check(`meal totals reconcile across ${mealChecked} random meals`, mealBad, 0);

// ---------------------------------------------------------------------------
// Eating window (intermittent fasting)
// ---------------------------------------------------------------------------
section("eating window");

// A normal daytime window, 12:00-20:00.
check("noon is inside 12:00-20:00", isWithinWindow(720, 720, 1200), true);
check("19:59 is inside", isWithinWindow(1199, 720, 1200), true);
check("20:00 is outside (end is exclusive)", isWithinWindow(1200, 720, 1200), false);
check("11:59 is outside", isWithinWindow(719, 720, 1200), false);
check("midnight is outside", isWithinWindow(0, 720, 1200), false);

// A window that WRAPS midnight, 20:00-04:00. A naive range check calls this
// empty, which would zero the score for anyone on a night schedule.
check("22:00 is inside 20:00-04:00", isWithinWindow(1320, 1200, 240), true);
check("01:00 is inside 20:00-04:00", isWithinWindow(60, 1200, 240), true);
check("12:00 is outside 20:00-04:00", isWithinWindow(720, 1200, 240), false);
check("04:00 is outside (end exclusive)", isWithinWindow(240, 1200, 240), false);

// A zero-length window must not mean "never eat".
check("zero-length window allows everything", isWithinWindow(600, 720, 720), true);

check("window length, normal", windowLength(720, 1200), 480);
check("window length, wrapping", windowLength(1200, 240), 480);
check("distance outside is 0 when inside", minutesOutsideWindow(800, 720, 1200), 0);
check("11:00 is 60 min before a noon start", minutesOutsideWindow(660, 720, 1200), 60);

// --- Scoring behaviour ---
const winTargets = { kcal: 2000, protein: 120 };
const WINDOW = { start: 720, end: 1200 }; // 12:00-20:00

function dayWith(mealMinutes: number[], window: { start: number; end: number } | null) {
  return computeDayScore({
    items: items(2000, 120, 1, mealMinutes.length),
    meals: mealMinutes.map((localMinutes) => ({ localMinutes })),
    targets: winTargets,
    bedtimeMinutes: 1380,
    goal: "maintain",
    eatingWindow: window,
  })!;
}

// All meals inside the window -> full timing marks.
const compliant = dayWith([780, 900, 1140], WINDOW);
check("fully compliant day gets full timing", compliant.components.find((c) => c.key === "timing")!.earned, 15);
check("  and the label says 'Eating window'", compliant.components.find((c) => c.key === "timing")!.label, "Eating window");
check("  total is 100", compliant.total, 100);

// One meal outside -> loses part of the window sub-score.
const oneOutside = dayWith([480, 780, 1140], WINDOW); // 08:00 is outside
const oneOutsideTiming = oneOutside.components.find((c) => c.key === "timing")!;
check("one meal outside costs points", oneOutsideTiming.earned < 15, true);
check("  and names the window in the detail", oneOutsideTiming.detail.includes("outside your eating window"), true);
check("  eating outside lowers the day total", oneOutside.total < compliant.total, true);

// Everything outside -> the window sub-score is zero, but the rest survives.
const allOutside = dayWith([420, 480, 600], WINDOW);
const allOutsideTiming = allOutside.components.find((c) => c.key === "timing")!;
check("all meals outside zeroes the window sub-score", allOutsideTiming.earned <= 7, true);
check("  calories and protein are unaffected", allOutside.components.find((c) => c.key === "calories")!.earned, 40);

// The window REPLACES the bedtime rule rather than stacking with it: a 23:30
// meal is late by the bedtime rule, but if the window permits it, it must not be
// penalized twice.
const lateButInWindow = dayWith([1320, 1380, 1400], { start: 1200, end: 240 });
check(
  "a late meal inside a night window is not penalized as 'late'",
  lateButInWindow.components.find((c) => c.key === "timing")!.detail.includes("bedtime"),
  false,
);

// Two meals is normal on a fasting schedule and must not be treated as a failure.
const twoMeals = dayWith([780, 1140], WINDOW);
check("two meals is fine with a window", twoMeals.components.find((c) => c.key === "timing")!.earned, 15);
const twoMealsNoWindow = dayWith([780, 1140], null);
check(
  "two meals still costs frequency points WITHOUT a window",
  twoMealsNoWindow.components.find((c) => c.key === "timing")!.earned < 15,
  true,
);

// With no window, behaviour must be exactly as before.
const noWindow = dayWith([480, 780, 1020, 1140], null);
check("no window keeps the old label", noWindow.components.find((c) => c.key === "timing")!.label, "Meal timing");
check("no window still scores 15 for a clean day", noWindow.components.find((c) => c.key === "timing")!.earned, 15);

section("water");

// US customary fl oz (29.5735 ml), NOT the imperial one (28.41) — a 4% error
// across a day's intake is about 3 oz, which is visible on a progress bar.
check("8 oz -> ml", Math.round(flOzToMl(8)), 237);
check("500 ml -> oz", Math.round(mlToFlOz(500)), 17);
check("round-trips at 64 oz", Math.round(mlToFlOz(flOzToMl(64))), 64);

check("formats imperial", formatVolume(2000, "imperial"), "68 oz");
check("formats metric litres", formatVolume(2000, "metric"), "2.0 L");
check("formats metric millilitres", formatVolume(750, "metric"), "750 ml");

// 35 ml/kg, rounded to the nearest 50 so the goal reads as a round number.
check("target scales with bodyweight", waterTarget(70, null), 2450);
check("target for a heavier person", waterTarget(90, null), 3150);
check("explicit override wins", waterTarget(70, 3000), 3000);
check("falls back without a weight", waterTarget(null, null), 2500);

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
