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
