"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addWater, removeWater } from "@/lib/actions";
import type { WaterDay } from "@/lib/queries";
import { formatLocalMinutes } from "@/lib/time";
import {
  WATER_PRESETS,
  flOzToMl,
  formatVolume,
  volumeUnitLabel,
  type UnitSystem,
} from "@/lib/units";

/**
 * Water tracking.
 *
 * Presets rather than a number field for the common case: logging a glass should
 * be one tap, and asking someone to type "237" every time is how a tracker stops
 * being used by Thursday. The custom field is there for everything else.
 *
 * Deliberately NOT part of the daily score — hydration wasn't one of the four
 * things the score was designed around, and folding it in would silently change
 * every score already recorded.
 */
export function Water({
  water,
  units,
  /**
   * When present, drinks are recorded on THAT day rather than now — this is what
   * makes a past day editable. An ISO instant, not a date string, so the server
   * derives localDate through the same helper every other write uses.
   */
  backdateTo,
}: {
  water: WaterDay;
  units: UnitSystem;
  backdateTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = Math.min(100, (water.totalMl / water.targetMl) * 100);
  const remaining = water.targetMl - water.totalMl;
  const presets = WATER_PRESETS[units];

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Could not save that.");
      else router.refresh();
    });
  }

  return (
    <section className="card p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">
            Water{backdateTo ? " (this day)" : ""}
          </h2>
          <p className="display mt-1 text-3xl leading-none tnum">
            {formatVolume(water.totalMl, units)}
            <span className="ml-1.5 font-sans text-sm text-muted">
              / {formatVolume(water.targetMl, units)}
            </span>
          </p>
        </div>
        <p className="text-xs text-muted tnum">
          {remaining > 0
            ? `${formatVolume(remaining, units)} to go`
            : "Goal reached"}
        </p>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
          role="img"
          aria-label={`${formatVolume(water.totalMl, units)} of ${formatVolume(water.targetMl, units)}`}
        />
      </div>

      {/* One tap per glass. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={pending}
            onClick={() => run(() => addWater(p.ml, backdateTo))}
            className="min-h-10 rounded-full border border-border px-3 text-xs hover:border-accent disabled:opacity-50"
          >
            + {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className="min-h-10 rounded-full border border-border px-3 text-xs text-muted hover:text-foreground"
        >
          Other
        </button>
      </div>

      {showCustom && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(custom);
            if (!Number.isFinite(n) || n <= 0) return;
            // The field is in the user's unit; storage is always millilitres.
            run(() => addWater(units === "imperial" ? flOzToMl(n) : n, backdateTo));
            setCustom("");
            setShowCustom(false);
          }}
        >
          <input
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={units === "imperial" ? "20" : "600"}
            aria-label={`Amount in ${volumeUnitLabel(units)}`}
            className="tnum min-h-10 w-24 rounded-md border border-border bg-background px-2 text-right"
          />
          <span className="text-xs text-muted">{volumeUnitLabel(units)}</span>
          <button
            type="submit"
            className="min-h-10 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg"
          >
            Add
          </button>
        </form>
      )}

      {water.logs.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
            {water.logs.length} {water.logs.length === 1 ? "drink" : "drinks"} today
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {water.logs.map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="text-muted">{formatLocalMinutes(l.localMinutes)}</span>
                <span className="tnum">{formatVolume(l.ml, units)}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeWater(l.id))}
                  className="ml-auto min-h-8 px-2 text-muted hover:text-negative"
                  aria-label={`Remove ${formatVolume(l.ml, units)} at ${formatLocalMinutes(l.localMinutes)}`}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
    </section>
  );
}
