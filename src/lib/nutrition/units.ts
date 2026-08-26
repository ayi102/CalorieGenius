/**
 * Per-food measurement units.
 *
 * The conversion is food-specific and that is the entire point: a cup of rice is
 * 160 g, a cup of spinach is 30 g. Generic volume tables are wrong for most
 * foods, so the options come from the parser, which knows what the food is, and
 * are stored on the item so a portion stays re-measurable later.
 */

export interface UnitOption {
  unit: string;
  gramsPerUnit: number;
}

/** Weight units are food-independent, so they are always available. */
const UNIVERSAL: UnitOption[] = [
  { unit: "g", gramsPerUnit: 1 },
  { unit: "oz", gramsPerUnit: 28.3495 },
];

/** Validate whatever came back from the model or out of the database. */
export function parseUnitOptions(raw: unknown): UnitOption[] {
  if (!Array.isArray(raw)) return [];
  const out: UnitOption[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const unit = (r as { unit?: unknown }).unit;
    const grams = (r as { gramsPerUnit?: unknown }).gramsPerUnit;
    if (typeof unit !== "string" || typeof grams !== "number") continue;
    // A zero or negative conversion would make the portion maths divide by zero.
    if (!Number.isFinite(grams) || grams <= 0) continue;
    out.push({ unit: unit.trim().toLowerCase(), gramsPerUnit: grams });
  }
  return out;
}

/**
 * The full set of units offered for one item.
 *
 * Merges the food-specific options with the universal weight units, keeps the
 * unit actually logged, and de-duplicates. Ordered so the food's natural unit
 * leads — someone measuring peanut butter wants tablespoons first, not grams.
 */
export function unitChoices(
  stored: unknown,
  loggedUnit: string,
  loggedGrams: number,
  loggedQuantity: number,
): UnitOption[] {
  const seen = new Map<string, UnitOption>();

  for (const o of parseUnitOptions(stored)) {
    if (!seen.has(o.unit)) seen.set(o.unit, o);
  }

  // Recover the logged unit's conversion from the entry itself when the parser
  // did not list it — older rows have no unitOptions at all.
  const unit = loggedUnit.trim().toLowerCase();
  if (unit && !seen.has(unit) && loggedQuantity > 0 && loggedGrams > 0) {
    seen.set(unit, { unit, gramsPerUnit: loggedGrams / loggedQuantity });
  }

  for (const u of UNIVERSAL) {
    if (!seen.has(u.unit)) seen.set(u.unit, u);
  }

  return [...seen.values()];
}

/** Grams for an amount in a given unit. */
export function toGrams(amount: number, option: UnitOption): number {
  return amount * option.gramsPerUnit;
}

/** How many of `unit` a gram weight represents, rounded for display. */
export function fromGrams(grams: number, option: UnitOption): number {
  const n = grams / option.gramsPerUnit;
  // Whole-ish units read better rounded; grams never need decimals.
  if (option.gramsPerUnit === 1) return Math.round(n);
  return Math.round(n * 100) / 100;
}
