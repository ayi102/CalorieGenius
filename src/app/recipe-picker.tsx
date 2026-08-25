"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickAddFood, relogEntry } from "@/lib/actions";
import type { RememberedFood, RememberedMeal } from "@/lib/queries";
import { scoreBand } from "@/lib/scoring";

const BAND: Record<string, string> = {
  none: "bg-score-none text-muted",
  poor: "bg-score-poor text-white",
  ok: "bg-score-ok text-white",
  good: "bg-score-good text-white",
  great: "bg-score-great text-white",
};

/**
 * Saved meals and foods, as a picker.
 *
 * Replaces a permanently-expanded "Log it again" list. That list was verbose
 * enough to push the day's actual meals off screen, and it was showing options
 * nobody had asked for yet. A "+" tile that opens this is quieter and gets the
 * meals back onto the first screen.
 *
 * Each recipe expands to show what's in it, its macros and its meal score —
 * because deciding whether to eat the same lunch again is exactly when that
 * information is useful.
 */
export function RecipePicker({
  meals,
  foods,
  onClose,
}: {
  meals: RememberedMeal[];
  foods: RememberedFood[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"meals" | "foods">("meals");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error ?? "Could not add that.");
      else {
        router.refresh();
        onClose();
      }
    });
  }

  const needle = query.trim().toLowerCase();
  const shownMeals = needle
    ? meals.filter((m) => m.rawText.toLowerCase().includes(needle))
    : meals;
  const shownFoods = needle
    ? foods.filter((f) => f.displayName.toLowerCase().includes(needle))
    : foods;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your saved meals"
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center"
    >
      {/* Tapping the backdrop closes — the reflex on a sheet like this. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25 backdrop-blur-sm"
      />

      {/* A bottom sheet on phones, a centred dialog on wider screens. */}
      <div
        className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-raised sm:max-w-lg sm:rounded-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="display flex-1 text-lg">Add from your meals</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-raised hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2 px-4 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your meals"
            aria-label="Search your meals"
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          {meals.length > 0 && foods.length > 0 && (
            <div className="flex gap-1 text-xs">
              {(["meals", "foods"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`min-h-9 rounded-full px-3 ${
                    tab === t
                      ? "bg-accent font-medium text-accent-fg"
                      : "border border-border text-muted"
                  }`}
                >
                  {t === "meals" ? "Meals" : "Single foods"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "meals" ? (
            shownMeals.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                {meals.length === 0
                  ? "Nothing saved yet. Log a meal and it'll appear here."
                  : "No match."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {shownMeals.map((m) => {
                  const expanded = open === m.entryId;
                  return (
                    <li key={m.entryId} className="py-2.5">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setOpen(expanded ? null : m.entryId)}
                          aria-expanded={expanded}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-sm [overflow-wrap:anywhere]">
                            {m.rawText}
                          </p>
                          <p className="tnum mt-0.5 text-xs text-muted">
                            {m.kcal} cal · {m.protein} g protein
                            {m.timesLogged > 1 && ` · ${m.timesLogged}×`}
                            {m.restaurantName && ` · ${m.restaurantName}`}
                          </p>
                        </button>

                        {m.score && (
                          <span
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded text-xs font-semibold tnum ${BAND[scoreBand(m.score.total)]}`}
                            title={m.score.headline}
                          >
                            {m.score.total}
                          </span>
                        )}

                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(m.entryId, () => relogEntry(m.entryId))}
                          className="min-h-9 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
                        >
                          {busy === m.entryId ? "…" : "Add"}
                        </button>
                      </div>

                      {expanded && (
                        <div className="mt-2 rounded-lg bg-surface-raised p-3">
                          {m.score && (
                            <p className="text-xs text-muted">{m.score.headline}</p>
                          )}
                          <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
                            {[
                              { l: "cal", v: m.kcal },
                              { l: "protein", v: `${m.protein} g` },
                              { l: "carbs", v: `${m.carbs} g` },
                              { l: "fiber", v: `${m.fiber} g` },
                            ].map((x) => (
                              <div key={x.l}>
                                <dd className="tnum text-sm font-medium">{x.v}</dd>
                                <dt className="text-[10px] text-muted">{x.l}</dt>
                              </div>
                            ))}
                          </dl>
                          <ul className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
                            {m.items.map((it, i) => (
                              <li
                                key={i}
                                className="flex items-baseline gap-2 text-xs text-muted"
                              >
                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                  {it.name}
                                </span>
                                <span className="tnum">{it.grams} g</span>
                                <span className="tnum w-10 text-right">{it.kcal}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : shownFoods.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No match.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {shownFoods.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm [overflow-wrap:anywhere]">
                      {f.displayName}
                    </p>
                    <p className="tnum mt-0.5 text-xs text-muted">
                      {f.kcalForDefault} cal ·{" "}
                      {f.unitIsServing ? "1 serving" : `${Math.round(f.defaultGrams)} g`}
                      {f.timesLogged > 1 && ` · ${f.timesLogged}×`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(f.id, () =>
                        quickAddFood(f.id, f.unitIsServing ? 1 : f.defaultGrams),
                      )
                    }
                    className="min-h-9 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
                  >
                    {busy === f.id ? "…" : "Add"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-2 text-sm text-negative">{error}</p>}
        </div>
      </div>
    </div>
  );
}
