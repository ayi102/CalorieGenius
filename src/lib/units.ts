/**
 * Unit conversion, confined to the UI boundary.
 *
 * The database stores body metrics in **metric only** (cm, kg). Imperial is a
 * display and input preference, converted here on the way in and out.
 *
 * That split is deliberate. Mifflin–St Jeor is defined in kg and cm, and the
 * protein target is g/kg — storing pounds would mean converting on every read,
 * and every conversion is a chance for rounding to drift. One canonical unit
 * internally, conversion only at the edges.
 *
 * Pure functions, no imports, so the assertion scripts can use them.
 */

export type UnitSystem = "imperial" | "metric";

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;
const KG_PER_LB = 0.45359237;

// --- Weight -----------------------------------------------------------------

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

// --- Height -----------------------------------------------------------------

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/**
 * Split centimetres into feet and whole inches.
 *
 * Rounds to the nearest inch first, then carries 12 inches into a foot — without
 * that carry, 179.9 cm would render as 5'12" instead of 6'0".
 */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cmToInches(cm));
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * INCHES_PER_FOOT + inches);
}

// --- Display ----------------------------------------------------------------

/** Format a stored weight for display, e.g. "137 lb" or "62.0 kg". */
export function formatWeight(kg: number | null, system: UnitSystem): string {
  if (kg === null) return "—";
  return system === "imperial"
    ? `${Math.round(kgToLb(kg))} lb`
    : `${kg.toFixed(1)} kg`;
}

/** Format a stored height for display, e.g. `5'5"` or "165 cm". */
export function formatHeight(cm: number | null, system: UnitSystem): string {
  if (cm === null) return "—";
  if (system === "metric") return `${Math.round(cm)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}'${inches}"`;
}

/** Label for a weight input in the given system. */
export function weightUnitLabel(system: UnitSystem): string {
  return system === "imperial" ? "lb" : "kg";
}

/**
 * Sane input bounds, expressed in the *displayed* unit so the browser's own
 * validation matches what the user is typing.
 */
export const BOUNDS = {
  weight: {
    imperial: { min: 45, max: 880, step: 1 }, // lb
    metric: { min: 20, max: 400, step: 0.1 }, // kg
  },
  heightCm: { min: 50, max: 260 },
  feet: { min: 1, max: 8 },
  inches: { min: 0, max: 11 },
} as const;

// --- Volume -----------------------------------------------------------------

/** US customary fluid ounce. Not the imperial fl oz, which is ~28.41 ml. */
const ML_PER_FL_OZ = 29.5735295625;

export function mlToFlOz(ml: number): number {
  return ml / ML_PER_FL_OZ;
}

export function flOzToMl(flOz: number): number {
  return flOz * ML_PER_FL_OZ;
}

/**
 * Quick-add sizes, chosen to match containers people actually drink from
 * rather than round numbers.
 *
 * Imperial: a glass, a standard bottle (the 16.9 fl oz / 500 ml one), and a
 * large bottle. Metric: the same volumes expressed how a metric user thinks of
 * them.
 */
export const WATER_PRESETS: Record<
  UnitSystem,
  { label: string; ml: number }[]
> = {
  imperial: [
    { label: "8 oz", ml: 237 },
    { label: "12 oz", ml: 355 },
    { label: "16.9 oz", ml: 500 },
    { label: "1 L", ml: 1000 },
  ],
  metric: [
    { label: "250 ml", ml: 250 },
    { label: "330 ml", ml: 330 },
    { label: "500 ml", ml: 500 },
    { label: "1 L", ml: 1000 },
  ],
};

/** Format a stored millilitre value for display, e.g. "68 oz" or "2.0 L". */
export function formatVolume(ml: number, system: UnitSystem): string {
  if (system === "imperial") return `${Math.round(mlToFlOz(ml))} oz`;
  return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`;
}

export function volumeUnitLabel(system: UnitSystem): string {
  return system === "imperial" ? "oz" : "ml";
}

/**
 * Daily water goal.
 *
 * 35 ml per kg of bodyweight is the common clinical rule of thumb, which is why
 * it scales with the profile rather than being a flat "8 glasses". Falls back to
 * 2500 ml when weight is unknown, and an explicit target always wins.
 */
export function waterTarget(
  weightKg: number | null,
  overrideMl: number | null,
): number {
  if (overrideMl && overrideMl > 0) return overrideMl;
  if (weightKg && weightKg > 0) return Math.round((weightKg * 35) / 50) * 50;
  return 2500;
}
