"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickAddFood, relogEntry } from "@/lib/actions";
import type { RememberedFood, RememberedMeal } from "@/lib/queries";

/**
 * "Log it again" — the app's memory, made visible.
 *
 * Every meal typed here is already stored with its resolved nutrition, so
 * re-logging copies those rows: no model call, no database lookup, no parse
 * quota. That is deliberate, and it is why this app never asks anyone to build
 * a recipe by hand — the text you typed the first time IS the recipe.
 */
export function Remembered({
  meals,
  foods,
}: {
  meals: RememberedMeal[];
  foods: RememberedFood[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"meals" | "foods">("meals");

  if (meals.length === 0 && foods.length === 0) return null;

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error ?? "Could not add that.");
      else router.refresh();
    });
  }

  const showTabs = meals.length > 0 && foods.length > 0;
  const active = meals.length === 0 ? "foods" : foods.length === 0 ? "meals" : tab;

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Log it again</h2>
        {showTabs && (
          <div className="flex gap-1 text-xs">
            {(["meals", "foods"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`min-h-8 rounded-md px-2.5 ${
                  active === t
                    ? "bg-accent-soft font-medium text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t === "meals" ? "Meals" : "Single foods"}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-muted">
        Anything you&apos;ve logged before. One tap, and it costs nothing.
      </p>

      {active === "meals" ? (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {meals.map((m) => (
            <li key={m.entryId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{m.rawText}</p>
                <p className="tnum mt-0.5 text-xs text-muted">
                  {m.kcal} cal · {m.protein} g protein · {m.itemCount}{" "}
                  {m.itemCount === 1 ? "item" : "items"}
                  {m.timesLogged > 1 && ` · ${m.timesLogged}×`}
                  {m.restaurantName && ` · ${m.restaurantName}`}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(m.entryId, () => relogEntry(m.entryId))}
                className="min-h-10 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
              >
                {busy === m.entryId ? "Adding…" : "Add now"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {foods.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(f.id, () =>
                    // Servings for label-backed foods, the stored portion otherwise.
                    quickAddFood(f.id, f.unitIsServing ? 1 : f.defaultGrams),
                  )
                }
                className="flex min-h-10 items-center gap-2 rounded-full border border-border px-3 text-xs hover:border-accent disabled:opacity-50"
              >
                <span className="max-w-40 truncate">{f.displayName}</span>
                <span className="tnum text-muted">{f.kcalForDefault}</span>
                {busy === f.id && <span className="text-muted">…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
    </section>
  );
}
