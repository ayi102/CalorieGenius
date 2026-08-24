"use client";

import { useActionState, useState } from "react";
import { updateProfile, type ActionResult } from "@/lib/actions";
import type { ProfileView } from "@/lib/queries";
import type { Targets } from "@/lib/scoring";
import { formatLocalMinutes, windowLength } from "@/lib/time";
import { ThemeToggle } from "../theme-toggle";
import {
  formatVolume,
  mlToFlOz,
  flOzToMl,
  waterTarget,
  volumeUnitLabel,
  BOUNDS,
  cmToFeetInches,
  kgToLb,
  type UnitSystem,
} from "@/lib/units";

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Sedentary — desk job, little exercise",
  light: "Light — exercise 1–3 days/week",
  moderate: "Moderate — exercise 3–5 days/week",
  active: "Active — exercise 6–7 days/week",
  very_active: "Very active — physical job or twice-daily training",
};

const GOAL_LABELS: Record<string, string> = {
  lose: "Lose weight (−20%)",
  maintain: "Maintain",
  gain: "Gain weight (+10%)",
};

/** Common zones first; anything else can be typed in. */
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

export function SettingsForm({
  profile,
  targets,
}: {
  profile: ProfileView;
  targets: Targets;
}) {
  const [result, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (_prev, formData) => updateProfile(formData), null);

  const [units, setUnits] = useState<UnitSystem>(profile.unitSystem);
  const [windowOn, setWindowOn] = useState(profile.eatingWindowEnabled);
  const [winStart, setWinStart] = useState(profile.eatingWindowStart);
  const [winEnd, setWinEnd] = useState(profile.eatingWindowEnd);

  const birthValue = profile.birthDate
    ? profile.birthDate.toISOString().slice(0, 10)
    : "";

  // Stored values are metric; render them in whichever system is selected.
  const ftIn =
    profile.heightCm !== null ? cmToFeetInches(profile.heightCm) : null;
  const lb = profile.weightKg !== null ? Math.round(kgToLb(profile.weightKg)) : null;

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {/* --- Targets summary. Shown first because it's the reason to fill the
          rest of the form in. --- */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Your daily targets</h2>
        {targets.computed ? (
          <p className="mt-1 text-xs text-muted">
            {profile.calorieTargetOverride === null &&
            profile.proteinTargetOverride === null
              ? `Computed from your profile: BMR ${targets.bmr} cal, TDEE ${targets.tdee} cal.`
              : "Partly overridden below."}
          </p>
        ) : (
          <p className="mt-1 text-xs text-warning">
            Fill in sex, birth date, height and weight to get personalized
            targets. Until then these are generic defaults.
          </p>
        )}
        <div className="mt-3 flex gap-6">
          <div>
            <div className="tnum text-2xl font-semibold">{targets.kcal}</div>
            <div className="text-xs text-muted">kcal / day</div>
          </div>
          <div>
            <div className="tnum text-2xl font-semibold">{targets.protein}</div>
            <div className="text-xs text-muted">g protein / day</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-sm font-semibold">About you</h2>

        <Field label="Name">
          <input name="name" defaultValue={profile.name ?? ""} className={inputClass} />
        </Field>

        <Field label="Email">
          <input value={profile.email} disabled className={`${inputClass} text-muted`} />
        </Field>

        <Field label="Sex" hint="Used by the BMR formula.">
          <select name="sex" defaultValue={profile.sex ?? ""} className={inputClass}>
            <option value="">Not set</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </Field>

        <Field label="Birth date">
          <input type="date" name="birthDate" defaultValue={birthValue} className={inputClass} />
        </Field>

        <Field label="Units">
          <select
            name="unitSystem"
            value={units}
            onChange={(e) => setUnits(e.target.value as UnitSystem)}
            className={inputClass}
          >
            <option value="imperial">Pounds and feet/inches</option>
            <option value="metric">Kilograms and centimetres</option>
          </select>
        </Field>

        {units === "imperial" ? (
          <>
            <Field label="Height">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="heightFeet"
                  min={BOUNDS.feet.min}
                  max={BOUNDS.feet.max}
                  defaultValue={ftIn?.feet ?? ""}
                  aria-label="Height, feet"
                  className={`${inputClass} w-20`}
                />
                <span className="text-sm text-muted">ft</span>
                <input
                  type="number"
                  name="heightInches"
                  min={BOUNDS.inches.min}
                  max={BOUNDS.inches.max}
                  defaultValue={ftIn?.inches ?? ""}
                  aria-label="Height, inches"
                  className={`${inputClass} w-20`}
                />
                <span className="text-sm text-muted">in</span>
              </div>
            </Field>

            <Field label="Weight (lb)" hint="Protein target is 0.73 g per pound.">
              <input
                type="number"
                name="weightLb"
                min={BOUNDS.weight.imperial.min}
                max={BOUNDS.weight.imperial.max}
                step={BOUNDS.weight.imperial.step}
                defaultValue={lb ?? ""}
                className={inputClass}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Height (cm)">
              <input
                type="number"
                name="heightCm"
                min={BOUNDS.heightCm.min}
                max={BOUNDS.heightCm.max}
                step="0.5"
                defaultValue={profile.heightCm ?? ""}
                className={inputClass}
              />
            </Field>

            <Field label="Weight (kg)" hint="Protein target is 1.6 g per kg.">
              <input
                type="number"
                name="weightKg"
                min={BOUNDS.weight.metric.min}
                max={BOUNDS.weight.metric.max}
                step={BOUNDS.weight.metric.step}
                defaultValue={profile.weightKg ?? ""}
                className={inputClass}
              />
            </Field>
          </>
        )}

        <Field label="Activity level">
          <select name="activityLevel" defaultValue={profile.activityLevel} className={inputClass}>
            {Object.entries(ACTIVITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Goal">
          <select name="goal" defaultValue={profile.goal} className={inputClass}>
            {Object.entries(GOAL_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-sm font-semibold">Day boundaries</h2>

        <Field
          label="Timezone"
          hint="Every day and month bucket is computed in this zone — a 9pm meal stays on today."
        >
          <input
            name="timezone"
            list="tz-options"
            defaultValue={profile.timezone}
            className={inputClass}
          />
        </Field>
        <datalist id="tz-options">
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>

        <Field
          label="Bedtime"
          hint={`Currently ${formatLocalMinutes(profile.bedtimeMinutes)}. Eating within 3 hours of it costs timing points.`}
        >
          <input
            type="time"
            name="bedtimeLocal"
            defaultValue={`${String(Math.floor(profile.bedtimeMinutes / 60)).padStart(2, "0")}:${String(profile.bedtimeMinutes % 60).padStart(2, "0")}`}
            className={inputClass}
            onChange={(e) => {
              // The action takes minutes-past-midnight; keep a hidden field in sync
              // so the server never has to parse a locale-dependent time string.
              const [h, m] = e.currentTarget.value.split(":").map(Number);
              const hidden = e.currentTarget.form?.elements.namedItem(
                "bedtimeMinutes",
              ) as HTMLInputElement | null;
              if (hidden && Number.isFinite(h) && Number.isFinite(m)) {
                hidden.value = String(h * 60 + m);
              }
            }}
          />
        </Field>
        <input type="hidden" name="bedtimeMinutes" defaultValue={profile.bedtimeMinutes} />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Eating window</h2>
          <p className="mt-1 text-xs text-muted">
            For intermittent fasting. Meals outside the window cost points in the
            timing part of your score. When it&apos;s on it replaces the bedtime
            rule, so a late meal isn&apos;t penalised twice.
          </p>
        </div>

        {/* Marks that the window section was submitted, so an unchecked box is
            read as false rather than "field absent, leave unchanged". */}
        <input type="hidden" name="eatingWindowSubmitted" value="1" />

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="eatingWindowEnabled"
            checked={windowOn}
            onChange={(e) => setWindowOn(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">Only eat between set hours</span>
        </label>

        {windowOn && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              <input
                type="time"
                value={minutesToTime(winStart)}
                onChange={(e) => setWinStart(timeToMinutes(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Until">
              <input
                type="time"
                value={minutesToTime(winEnd)}
                onChange={(e) => setWinEnd(timeToMinutes(e.target.value))}
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-muted">
              {windowLength(winStart, winEnd) / 60 === 24
                ? "That window covers the whole day."
                : `${(windowLength(winStart, winEnd) / 60).toFixed(1)} h window · ${(24 - windowLength(winStart, winEnd) / 60).toFixed(1)} h fast`}
              {winEnd <= winStart && winEnd !== winStart && " (crosses midnight)"}
            </p>
          </div>
        )}
        <input type="hidden" name="eatingWindowStart" value={winStart} />
        <input type="hidden" name="eatingWindowEnd" value={winEnd} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Water</h2>
        <Field
          label={`Daily goal (${volumeUnitLabel(profile.unitSystem)})`}
          hint={`Leave blank for 35 ml per kg of bodyweight — currently ${formatVolume(
            waterTarget(profile.weightKg, null),
            profile.unitSystem,
          )}.`}
        >
          <input
            type="number"
            name="waterTargetDisplay"
            min={profile.unitSystem === "imperial" ? 8 : 250}
            max={profile.unitSystem === "imperial" ? 270 : 8000}
            step="any"
            defaultValue={
              profile.waterTargetMl === null
                ? ""
                : profile.unitSystem === "imperial"
                  ? Math.round(mlToFlOz(profile.waterTargetMl))
                  : profile.waterTargetMl
            }
            placeholder={String(
              profile.unitSystem === "imperial"
                ? Math.round(mlToFlOz(waterTarget(profile.weightKg, null)))
                : waterTarget(profile.weightKg, null),
            )}
            className={inputClass}
            onChange={(e) => {
              // Storage is millilitres regardless of what is displayed; keep the
              // hidden canonical field in step.
              const hidden = e.currentTarget.form?.elements.namedItem(
                "waterTargetMl",
              ) as HTMLInputElement | null;
              if (!hidden) return;
              const raw = e.currentTarget.value.trim();
              if (raw === "") {
                hidden.value = "";
                return;
              }
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              hidden.value = String(
                Math.round(profile.unitSystem === "imperial" ? flOzToMl(n) : n),
              );
            }}
          />
        </Field>
        <input
          type="hidden"
          name="waterTargetMl"
          defaultValue={profile.waterTargetMl ?? ""}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <ThemeToggle />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-sm font-semibold">
          Overrides
          <span className="ml-2 font-normal text-muted">
            Leave blank to use the computed values.
          </span>
        </h2>

        <Field label="Calorie target">
          <input
            type="number"
            name="calorieTargetOverride"
            min={800}
            max={8000}
            defaultValue={profile.calorieTargetOverride ?? ""}
            placeholder={String(targets.kcal)}
            className={inputClass}
          />
        </Field>

        <Field label="Protein target (g)">
          <input
            type="number"
            name="proteinTargetOverride"
            min={20}
            max={400}
            defaultValue={profile.proteinTargetOverride ?? ""}
            placeholder={String(targets.protein)}
            className={inputClass}
          />
        </Field>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {result?.ok && <span className="text-sm text-positive">Saved.</span>}
        {result && !result.ok && (
          <span className="text-sm text-negative">{result.error}</span>
        )}
      </div>
    </form>
  );
}

/** minutes-past-midnight -> "HH:MM" for a time input. */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" -> minutes past midnight. Returns 0 on anything unparseable. */
function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}
