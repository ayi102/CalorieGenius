/**
 * Targets and the daily score.
 *
 * Pure math: no DB, no framework, no `Date.now()`. Everything the score depends
 * on arrives as an argument, which is what makes it assertable from a plain
 * `tsx` script (see scripts/check-scoring.ts) and safe to reuse client-side for
 * live totals as the user types.
 *
 * Design commitments:
 *  - Every component is returned individually. A bare "72" tells you nothing;
 *    "you hit calories and protein, lost points on late-night eating" is the
 *    product.
 *  - A day with no food scores `null`, not 0. An untracked day is not a bad day,
 *    and conflating them would poison the month average.
 */

import { isWithinWindow, minutesUntil } from "@/lib/time";

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type Sex = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type Goal = "lose" | "maintain" | "gain";

/** Standard TDEE multipliers applied to BMR. */
const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Calorie adjustment applied to TDEE, by goal. */
const GOAL_ADJUSTMENT: Record<Goal, number> = {
  lose: -0.2,
  maintain: 0,
  gain: 0.1,
};

/** Grams of protein per kg of bodyweight. */
const PROTEIN_G_PER_KG = 1.6;

export interface TargetInput {
  sex: Sex | null;
  /** Whole years. Pass null if birthDate is unknown. */
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel;
  goal: Goal;
  calorieTargetOverride: number | null;
  proteinTargetOverride: number | null;
}

export interface Targets {
  kcal: number;
  protein: number;
  /** True when the numbers came from the formula rather than a manual override. */
  computed: boolean;
  /** Null when the profile is too incomplete to compute a BMR. */
  bmr: number | null;
  tdee: number | null;
}

/**
 * Mifflin–St Jeor BMR → activity multiplier → TDEE → goal adjustment.
 *
 * Mifflin–St Jeor is the current standard for indirect BMR estimation and is
 * more accurate than Harris–Benedict for modern populations.
 *
 *   male:   10*kg + 6.25*cm − 5*age + 5
 *   female: 10*kg + 6.25*cm − 5*age − 161
 *
 * An incomplete profile yields no computed target — better to prompt for the
 * missing field than to score against a fabricated number. Overrides always win.
 */
export function computeTargets(input: TargetInput): Targets {
  const { sex, ageYears, heightCm, weightKg, activityLevel, goal } = input;

  const canCompute =
    sex !== null &&
    ageYears !== null &&
    heightCm !== null &&
    weightKg !== null &&
    ageYears > 0 &&
    heightCm > 0 &&
    weightKg > 0;

  let bmr: number | null = null;
  let tdee: number | null = null;

  if (canCompute) {
    const base = 10 * weightKg! + 6.25 * heightCm! - 5 * ageYears!;
    bmr = sex === "male" ? base + 5 : base - 161;
    tdee = bmr * ACTIVITY_MULTIPLIER[activityLevel];
  }

  const computedKcal =
    tdee === null ? null : Math.round(tdee * (1 + GOAL_ADJUSTMENT[goal]));
  const computedProtein =
    weightKg === null || weightKg <= 0
      ? null
      : Math.round(weightKg * PROTEIN_G_PER_KG);

  const kcal = input.calorieTargetOverride ?? computedKcal;
  const protein = input.proteinTargetOverride ?? computedProtein;

  return {
    // Fall back to widely-used defaults only so the UI never divides by null;
    // `computed` tells the caller these are not personalized.
    kcal: kcal ?? 2000,
    protein: protein ?? 100,
    computed: kcal !== null && protein !== null,
    bmr: bmr === null ? null : Math.round(bmr),
    tdee: tdee === null ? null : Math.round(tdee),
  };
}

/** Whole years from a birth date to a reference instant. */
export function ageFrom(birthDate: Date, asOf: Date): number {
  let age = asOf.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < birthDate.getUTCMonth() ||
    (asOf.getUTCMonth() === birthDate.getUTCMonth() &&
      asOf.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Daily score
// ---------------------------------------------------------------------------

/** Maximum points per component. They sum to 100 by construction. */
export const COMPONENT_MAX = {
  calories: 40,
  protein: 25,
  quality: 20,
  timing: 15,
} as const;

export type ComponentKey = keyof typeof COMPONENT_MAX;

export interface ScoreItem {
  kcal: number;
  protein: number;
  /** Carried so the day's macro totals come out of the same pass. */
  carbs: number;
  fat: number;
  /** Optional — only the meal score uses it. Absent counts as zero. */
  fiber?: number;
  /** NOVA-style 1 (whole food) .. 4 (ultra-processed). */
  processedLevel: number;
}

export interface ScoreMeal {
  /** Minutes past local midnight, from toLocalMinutes(). */
  localMinutes: number;
}

/** An optional eating window, in minutes past local midnight. */
export interface EatingWindow {
  start: number;
  end: number;
}

export interface DayScoreInput {
  items: ScoreItem[];
  meals: ScoreMeal[];
  targets: Pick<Targets, "kcal" | "protein">;
  /** Local bedtime as minutes past midnight. Used only when no window is set. */
  bedtimeMinutes: number;
  goal: Goal;
  /**
   * When set, meals outside the window cost points and the bedtime rule is NOT
   * applied — the two measure the same thing, so using both would penalize the
   * same late meal twice.
   */
  eatingWindow?: EatingWindow | null;
}

export interface ScoreComponent {
  /** A day component key or a meal component key — the two sets differ. */
  key: ComponentKey | MealComponentKey;
  label: string;
  earned: number;
  max: number;
  /** One short human sentence explaining what happened. */
  detail: string;
}

export interface DayScore {
  total: number;
  components: ScoreComponent[];
  totals: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    mealCount: number;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Calorie adherence, 40 points.
 *
 * Full marks inside ±5% of target, decaying linearly to zero at ±40%. When the
 * goal is weight loss, overshoot is scaled 1.25× before scoring — going over is
 * more costly to that goal than coming in under.
 */
function scoreCalories(
  kcal: number,
  target: number,
  goal: Goal,
): ScoreComponent {
  const max = COMPONENT_MAX.calories;
  const deviation = (kcal - target) / target;
  const weighted =
    goal === "lose" && deviation > 0 ? deviation * 1.25 : deviation;
  const magnitude = Math.abs(weighted);

  const FULL = 0.05;
  const ZERO = 0.4;
  const earned =
    magnitude <= FULL
      ? max
      : magnitude >= ZERO
        ? 0
        : max * (1 - (magnitude - FULL) / (ZERO - FULL));

  const over = kcal > target;
  const pct = Math.round(Math.abs(deviation) * 100);
  const detail =
    magnitude <= FULL
      ? `On target at ${Math.round(kcal)} kcal.`
      : `${pct}% ${over ? "over" : "under"} your ${target} kcal target.`;

  return { key: "calories", label: "Calories", earned: round1(earned), max, detail };
}

/**
 * Protein, 25 points. Linear from zero to target, capped — there is no reward
 * for overshooting, so the score cannot be gamed with a protein shake.
 */
function scoreProtein(protein: number, target: number): ScoreComponent {
  const max = COMPONENT_MAX.protein;
  const ratio = target <= 0 ? 1 : clamp(protein / target, 0, 1);
  const earned = max * ratio;
  const detail =
    ratio >= 1
      ? `Hit your ${target} g protein target.`
      : `${Math.round(protein)} g of ${target} g protein.`;
  return { key: "protein", label: "Protein", earned: round1(earned), max, detail };
}

/**
 * Food quality, 20 points, from a **calorie-weighted** mean processing level.
 *
 * Weighting by calories rather than by item count is the important part: a salad
 * plus a large pizza should not read as "half whole food".
 */
function scoreQuality(items: ScoreItem[]): ScoreComponent {
  const max = COMPONENT_MAX.quality;
  const totalKcal = items.reduce((s, i) => s + i.kcal, 0);

  // Zero-calorie days (e.g. black coffee only) fall back to an unweighted mean
  // so the component still says something rather than dividing by zero.
  const mean =
    totalKcal > 0
      ? items.reduce((s, i) => s + i.processedLevel * i.kcal, 0) / totalKcal
      : items.reduce((s, i) => s + i.processedLevel, 0) / items.length;

  const earned = clamp(max * ((4 - mean) / 3), 0, max);
  const detail =
    mean <= 1.5
      ? "Almost entirely whole foods."
      : mean <= 2.5
        ? "Mostly minimally processed."
        : mean <= 3.3
          ? "Leaning processed."
          : "Mostly ultra-processed.";

  return { key: "quality", label: "Food quality", earned: round1(earned), max, detail };
}

/**
 * Timing, 15 points, split three ways:
 *   - 7 for eating 3–5 times (2.5 lost per meal outside that range)
 *   - 5 for nothing in the 3 hours before bedtime or after it
 *   - 3 for no gap longer than 6 hours between meals
 *
 * Bedtime proximity uses circular clock arithmetic so an 11pm bedtime and a 1am
 * snack behave correctly without special-casing midnight.
 */
function scoreTiming(
  meals: ScoreMeal[],
  bedtimeMinutes: number,
  window: EatingWindow | null,
): ScoreComponent {
  const max = COMPONENT_MAX.timing;
  const count = meals.length;
  const usingWindow = window !== null;

  // When an eating window is set, adherence to it is what the user actually
  // cares about, so it carries more of the 15 points than meal frequency does.
  const FREQ_MAX = usingWindow ? 4 : 7;
  const RULE_MAX = usingWindow ? 8 : 5;
  const SPACING_MAX = 3;

  // --- meal frequency ---
  const IDEAL_LOW = 3;
  const IDEAL_HIGH = 5;
  const distance =
    count < IDEAL_LOW ? IDEAL_LOW - count : count > IDEAL_HIGH ? count - IDEAL_HIGH : 0;
  // A window usually means fewer, larger meals, so 2 is not a failure there.
  const freqFloor = usingWindow && count === 2 ? 0 : distance;
  const frequencyPts = clamp(FREQ_MAX - (FREQ_MAX / 2.8) * freqFloor, 0, FREQ_MAX);

  // --- the rule: either window adherence, or bedtime proximity ---
  let rulePts: number;
  let ruleNote: string | null = null;

  if (usingWindow) {
    const outside = meals.filter(
      (m) => !isWithinWindow(m.localMinutes, window.start, window.end),
    ).length;
    // All-or-nothing per meal: fasting adherence is binary in the user's mind,
    // so a partial credit for "only slightly outside" would misrepresent it.
    rulePts = clamp(RULE_MAX * (1 - outside / Math.max(1, count)), 0, RULE_MAX);
    if (outside > 0) {
      ruleNote = `${outside} meal${outside > 1 ? "s" : ""} outside your eating window`;
    }
  } else {
    const LATE_WINDOW_BEFORE = 180;
    const AFTER_BED_GRACE = -360;
    const lateMeals = meals.filter((m) => {
      const until = minutesUntil(m.localMinutes, bedtimeMinutes);
      return until <= LATE_WINDOW_BEFORE && until > AFTER_BED_GRACE;
    }).length;
    rulePts = clamp(RULE_MAX - 2.5 * lateMeals, 0, RULE_MAX);
    if (lateMeals > 0) {
      ruleNote = `${lateMeals} late meal${lateMeals > 1 ? "s" : ""} near bedtime`;
    }
  }

  // --- spacing ---
  const sorted = meals.map((m) => m.localMinutes).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }
  const GAP_OK = 360;
  const GAP_ZERO = 600;
  // A fasting window makes a long gap the whole point, so spacing is not scored.
  const spacingPts = usingWindow
    ? SPACING_MAX
    : sorted.length < 2
      ? 0
      : maxGap <= GAP_OK
        ? SPACING_MAX
        : maxGap >= GAP_ZERO
          ? 0
          : SPACING_MAX * (1 - (maxGap - GAP_OK) / (GAP_ZERO - GAP_OK));

  const earned = frequencyPts + rulePts + spacingPts;

  const notes: string[] = [];
  if (freqFloor > 0) notes.push(`ate ${count}\u00d7`);
  if (ruleNote) notes.push(ruleNote);
  if (!usingWindow && sorted.length >= 2 && maxGap > GAP_OK) {
    notes.push(`a ${Math.round(maxGap / 60)}h gap between meals`);
  }

  return {
    key: "timing",
    label: usingWindow ? "Eating window" : "Meal timing",
    earned: round1(earned),
    max,
    detail:
      notes.length === 0
        ? usingWindow
          ? "Everything inside your eating window."
          : "Well-spaced meals, nothing late."
        : capitalize(notes.join(", ")) + ".",
  };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Score one local day, 0–100.
 *
 * Returns `null` for a day with no food logged — the caller must render that as
 * "untracked", never as a zero.
 */
export function computeDayScore(input: DayScoreInput): DayScore | null {
  const { items, meals, targets, bedtimeMinutes, goal } = input;
  const window = input.eatingWindow ?? null;
  if (items.length === 0) return null;

  const kcal = items.reduce((s, i) => s + i.kcal, 0);
  const protein = items.reduce((s, i) => s + i.protein, 0);
  const carbs = items.reduce((s, i) => s + i.carbs, 0);
  const fat = items.reduce((s, i) => s + i.fat, 0);

  const components = [
    scoreCalories(kcal, targets.kcal, goal),
    scoreProtein(protein, targets.protein),
    scoreQuality(items),
    scoreTiming(meals, bedtimeMinutes, window),
  ];

  const total = Math.round(components.reduce((s, c) => s + c.earned, 0));

  return {
    total: clamp(total, 0, 100),
    components,
    totals: {
      kcal: Math.round(kcal),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
      mealCount: meals.length,
    },
  };
}

/** Coarse band for colouring a score in the UI. */
export function scoreBand(score: number | null): "none" | "poor" | "ok" | "good" | "great" {
  if (score === null) return "none";
  if (score < 50) return "poor";
  if (score < 70) return "ok";
  if (score < 85) return "good";
  return "great";
}

// ---------------------------------------------------------------------------
// Meal score
// ---------------------------------------------------------------------------

/**
 * A meal is scored on different things than a day.
 *
 * "Calories vs your daily target" and "meal timing" are properties of a whole
 * day — asking them of one meal is meaningless. So a meal is judged on what is
 * intrinsic to it: how processed it is, how much protein it carries per calorie,
 * how much fiber, and whether its size is sensible for that slot in the day.
 *
 * Densities (per 100 kcal) rather than absolute grams are the key choice: they
 * make a 300 kcal breakfast and a 900 kcal dinner directly comparable, which is
 * what makes the number worth showing at all.
 */
export const MEAL_COMPONENT_MAX = {
  quality: 40,
  protein: 30,
  fiber: 15,
  size: 15,
} as const;

export type MealComponentKey = keyof typeof MEAL_COMPONENT_MAX;

/**
 * Roughly how much of a day's calories each slot is expected to carry. Used only
 * to judge whether a meal's size is reasonable, never to prescribe a schedule.
 */
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

const EXPECTED_SHARE: Record<MealType, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.35,
  snack: 0.1,
};

/** Protein density, g per 100 kcal, that earns full marks. */
const PROTEIN_DENSITY_TARGET = 8;
/** Fiber density, g per 100 kcal, that earns full marks. */
const FIBER_DENSITY_TARGET = 1.4;

export interface MealScore {
  total: number;
  /** One short sentence: the "why" shown without expanding anything. */
  headline: string;
  components: ScoreComponent[];
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
}

/**
 * Score a single meal, 0–100. Returns null for a meal with no items.
 *
 * `dailyKcalTarget` is used only by the size component; everything else is
 * intrinsic to the meal.
 */
export function computeMealScore(
  items: ScoreItem[],
  mealType: MealType,
  dailyKcalTarget: number,
): MealScore | null {
  if (items.length === 0) return null;

  const kcal = items.reduce((s, i) => s + i.kcal, 0);
  const protein = items.reduce((s, i) => s + i.protein, 0);
  const carbs = items.reduce((s, i) => s + i.carbs, 0);
  const fat = items.reduce((s, i) => s + i.fat, 0);
  const fiber = items.reduce((s, i) => s + (i.fiber ?? 0), 0);

  // --- Quality (40): calorie-weighted processing level. Same rule as the day
  // score, so the two never disagree about the same food.
  const qualityMean =
    kcal > 0
      ? items.reduce((s, i) => s + i.processedLevel * i.kcal, 0) / kcal
      : items.reduce((s, i) => s + i.processedLevel, 0) / items.length;
  const qualityPts = clamp(MEAL_COMPONENT_MAX.quality * ((4 - qualityMean) / 3), 0, MEAL_COMPONENT_MAX.quality);

  // --- Protein (30): density, so meal size doesn't distort it.
  const proteinDensity = kcal > 0 ? (protein / kcal) * 100 : 0;
  const proteinPts = clamp(
    MEAL_COMPONENT_MAX.protein * (proteinDensity / PROTEIN_DENSITY_TARGET),
    0,
    MEAL_COMPONENT_MAX.protein,
  );

  // --- Fiber (15): the plants proxy.
  const fiberDensity = kcal > 0 ? (fiber / kcal) * 100 : 0;
  const fiberPts = clamp(
    MEAL_COMPONENT_MAX.fiber * (fiberDensity / FIBER_DENSITY_TARGET),
    0,
    MEAL_COMPONENT_MAX.fiber,
  );

  // --- Size (15): full marks within ±35% of the expected share, tapering to
  // zero at ±100%. Deliberately forgiving — a big dinner is a preference, not a
  // mistake, and the day score already handles total intake.
  const expected = dailyKcalTarget * EXPECTED_SHARE[mealType];
  const sizeDeviation = expected > 0 ? Math.abs(kcal - expected) / expected : 0;
  const SIZE_FULL = 0.35;
  const SIZE_ZERO = 1.0;
  const sizePts =
    sizeDeviation <= SIZE_FULL
      ? MEAL_COMPONENT_MAX.size
      : sizeDeviation >= SIZE_ZERO
        ? 0
        : MEAL_COMPONENT_MAX.size *
          (1 - (sizeDeviation - SIZE_FULL) / (SIZE_ZERO - SIZE_FULL));

  const components: ScoreComponent[] = [
    {
      key: "quality",
      label: "Food quality",
      earned: round1(qualityPts),
      max: MEAL_COMPONENT_MAX.quality,
      detail:
        qualityMean <= 1.5
          ? "Whole, unprocessed food."
          : qualityMean <= 2.5
            ? "Mostly minimally processed."
            : qualityMean <= 3.3
              ? "Leaning processed."
              : "Mostly ultra-processed.",
    },
    {
      key: "protein",
      label: "Protein",
      earned: round1(proteinPts),
      max: MEAL_COMPONENT_MAX.protein,
      detail: `${proteinDensity.toFixed(1)} g per 100 kcal${
        proteinDensity >= PROTEIN_DENSITY_TARGET
          ? " — protein-rich."
          : proteinDensity >= 4
            ? " — reasonable."
            : " — light on protein."
      }`,
    },
    {
      key: "fiber",
      label: "Fiber",
      earned: round1(fiberPts),
      max: MEAL_COMPONENT_MAX.fiber,
      detail:
        fiber <= 0
          ? "No fiber — no vegetables, fruit, or whole grains."
          : `${fiber.toFixed(1)} g of fiber${fiberDensity >= FIBER_DENSITY_TARGET ? " — plenty." : " — could use more plants."}`,
    },
    {
      key: "size",
      label: "Portion size",
      earned: round1(sizePts),
      max: MEAL_COMPONENT_MAX.size,
      detail:
        sizeDeviation <= SIZE_FULL
          ? `${Math.round(kcal)} kcal — about right for ${mealType}.`
          : kcal > expected
            ? `${Math.round(kcal)} kcal — large for ${mealType} (~${Math.round(expected)} expected).`
            : `${Math.round(kcal)} kcal — small for ${mealType} (~${Math.round(expected)} expected).`,
    },
  ];

  const total = clamp(Math.round(components.reduce((s, c) => s + c.earned, 0)), 0, 100);

  return {
    total,
    headline: mealHeadline(components, total),
    components,
    totals: {
      kcal: Math.round(kcal),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
      fiber: Math.round(fiber * 10) / 10,
    },
  };
}

/**
 * One sentence naming the meal's best and worst component.
 *
 * Built from the actual scores rather than canned text, so it cannot drift out
 * of agreement with the breakdown underneath it.
 */
function mealHeadline(components: ScoreComponent[], total: number): string {
  const ranked = [...components].sort(
    (a, b) => b.earned / b.max - a.earned / a.max,
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const worstRatio = worst.earned / worst.max;
  const bestRatio = best.earned / best.max;

  // The headline must never contradict the number beside it: a 90+ meal has no
  // weakness worth naming, even if one component is technically its lowest.
  if (total >= 90) return "Strong across the board.";

  // Nothing meaningfully weak.
  if (worstRatio >= 0.8) return "Strong across the board.";
  // Nothing meaningfully strong.
  if (bestRatio < 0.5) {
    return `Weak overall — ${worst.label.toLowerCase()} is the biggest gap.`;
  }

  const shortfall: Record<string, string> = {
    "Food quality": "processed",
    Protein: "low on protein",
    Fiber: "low on fiber",
    "Portion size": "off on portion size",
  };

  return `${total >= 70 ? "Good" : "Mixed"} — strong ${best.label.toLowerCase()}, ${shortfall[worst.label] ?? "weak " + worst.label.toLowerCase()}.`;
}
