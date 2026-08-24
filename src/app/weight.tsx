"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logWeight } from "@/lib/actions";
import type { WeightHistory } from "@/lib/queries";
import { kgToLb, lbToKg, weightUnitLabel, type UnitSystem } from "@/lib/units";

/**
 * Weigh-in log.
 *
 * The change line is the point — a single number tells you nothing, and the
 * whole reason to record weight is to see direction. A week's change is shown
 * separately from the window's because week-to-week movement is mostly water
 * and reading a trend from it is a mistake.
 */
export function Weight({
  history,
  units,
  goal,
}: {
  history: WeightHistory;
  units: UnitSystem;
  goal: "lose" | "maintain" | "gain";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unit = weightUnitLabel(units);
  const show = (kg: number) =>
    units === "imperial" ? Math.round(kgToLb(kg)) : Math.round(kg * 10) / 10;

  // A change is only meaningful in the direction of the goal.
  const change = history.changeKg;
  const good =
    change === null
      ? null
      : goal === "lose"
        ? change < 0
        : goal === "gain"
          ? change > 0
          : Math.abs(change) < 1;

  return (
    <section className="card p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Weight</h2>
          <p className="display mt-1 text-3xl leading-none tnum">
            {history.latest ? show(history.latest.weightKg) : "—"}
            <span className="ml-1 font-sans text-sm text-muted">{unit}</span>
          </p>
        </div>
        {change !== null && (
          <div className="text-right">
            <p
              className={`tnum text-sm font-medium ${good ? "text-positive" : "text-muted"}`}
            >
              {change > 0 ? "+" : ""}
              {units === "imperial"
                ? (kgToLb(change)).toFixed(1)
                : change.toFixed(1)}{" "}
              {unit}
            </p>
            <p className="text-xs text-muted">
              over {history.points.length} weigh-ins
            </p>
          </div>
        )}
      </div>

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return;
          setError(null);
          start(async () => {
            const r = await logWeight(units === "imperial" ? lbToKg(n) : n);
            if (!r.ok) setError(r.error ?? "Could not save that.");
            else {
              setValue("");
              router.refresh();
            }
          });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Today&apos;s weight</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={units === "imperial" ? 45 : 20}
              max={units === "imperial" ? 880 : 400}
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={history.latest ? String(show(history.latest.weightKg)) : ""}
              className="tnum min-h-11 w-24 rounded-md border border-border bg-background px-2 text-right"
              aria-label={`Weight in ${unit}`}
            />
            <span className="text-xs text-muted">{unit}</span>
          </div>
        </label>
        <button
          type="submit"
          disabled={pending || value.trim() === ""}
          className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log"}
        </button>
      </form>

      {history.weekChangeKg !== null && (
        <p className="mt-2 text-xs text-muted tnum">
          {history.weekChangeKg > 0 ? "+" : ""}
          {units === "imperial"
            ? kgToLb(history.weekChangeKg).toFixed(1)
            : history.weekChangeKg.toFixed(1)}{" "}
          {unit} this week — mostly water at this range, so don&apos;t read a
          trend into one week.
        </p>
      )}

      {history.points.length === 0 && (
        <p className="mt-2 text-xs text-muted">
          Logging weight updates your calorie target too, since it&apos;s
          computed from your bodyweight.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
    </section>
  );
}
