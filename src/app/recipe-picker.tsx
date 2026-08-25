"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecipe, logRecipe, relogEntry } from "@/lib/actions";
import type { RecipeView, RememberedMeal } from "@/lib/queries";
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
  recipes,
  meals,
  onClose,
}: {
  recipes: RecipeView[];
  meals: RememberedMeal[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /**
   * Three tabs, all of them HER OWN WORDS, split by what they produced:
   *
   *   mine     — recipes she declared and named. Intent, not inference.
   *   detected — prompts that came back as several ingredients, so the app
   *              recognised a composite: "sushi - salmon, rice, avocado".
   *   prompts  — prompts that came back as one thing: "a latte", "an apple".
   *
   * The old third tab listed FoodItem rows, which is what put "espresso" and
   * "ground cinnamon" in front of her. Those were never things she typed — they
   * were fragments the parser made. Every tab here is text she actually wrote.
   *
   * Opens on whichever has content, preferring her own.
   */
  const [tab, setTab] = useState<"mine" | "detected" | "prompts">(
    recipes.length > 0
      ? "mine"
      : meals.some((m) => m.itemCount > 1)
        ? "detected"
        : "prompts",
  );
  const [servingsFor, setServingsFor] = useState<Record<string, string>>({});


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
  const shownRecipes = needle
    ? recipes.filter((r) => r.name.toLowerCase().includes(needle))
    : recipes;

  const matched = needle
    ? meals.filter((m) => m.rawText.toLowerCase().includes(needle))
    : meals;
  // A prompt that produced several items is a composite the app detected; one
  // that produced a single item is just a thing she logged.
  const detected = matched.filter((m) => m.itemCount > 1);
  const simple = matched.filter((m) => m.itemCount === 1);
  const shownMeals = tab === "detected" ? detected : simple;


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
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 text-xs">
            {(
              [
                ["mine", "My Recipes", recipes.length],
                [
                  "detected",
                  "Detected Recipes",
                  meals.filter((m) => m.itemCount > 1).length,
                ],
                [
                  "prompts",
                  "Prompts",
                  meals.filter((m) => m.itemCount === 1).length,
                ],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`min-h-9 shrink-0 rounded-full px-3 ${
                  tab === id
                    ? "bg-accent font-medium text-accent-fg"
                    : "border border-border text-muted"
                }`}
              >
                {label}
                {count > 0 && (
                  <span className="tnum ml-1 opacity-70">{count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "mine" ? (
            shownRecipes.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-muted">
                  {recipes.length === 0
                    ? "No saved recipes yet."
                    : "No match."}
                </p>
                {recipes.length === 0 && (
                  <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
                    Type the ingredients on the main screen, press{" "}
                    <span className="text-foreground">Recipe</span>, then name it
                    and say how many servings it makes.
                  </p>
                )}
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {shownRecipes.map((r) => {
                  const expanded = open === r.id;
                  const n = servingsFor[r.id] ?? "1";
                  return (
                    <li key={r.id} className="py-2.5">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setOpen(expanded ? null : r.id)}
                          aria-expanded={expanded}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-sm font-medium [overflow-wrap:anywhere]">
                            {r.name}
                          </p>
                          <p className="tnum mt-0.5 text-xs text-muted">
                            {r.perServing.kcal} cal · {r.perServing.protein} g
                            protein · per serving
                            {r.servings > 1 && ` · makes ${r.servings}`}
                            {r.timesLogged > 0 && ` · ${r.timesLogged}×`}
                          </p>
                        </button>

                        {r.score && (
                          <span
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded text-xs font-semibold tnum ${BAND[scoreBand(r.score.total)]}`}
                            title={r.score.headline}
                          >
                            {r.score.total}
                          </span>
                        )}

                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(r.id, () => logRecipe(r.id, Number(n) || 1))
                          }
                          className="min-h-9 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
                        >
                          {busy === r.id ? "…" : "Add"}
                        </button>
                      </div>

                      {expanded && (
                        <div className="mt-2 rounded-lg bg-surface-raised p-3">
                          {r.score && (
                            <p className="text-xs text-muted">{r.score.headline}</p>
                          )}
                          <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
                            {[
                              { l: "cal", v: r.perServing.kcal },
                              { l: "protein", v: `${r.perServing.protein} g` },
                              { l: "carbs", v: `${r.perServing.carbs} g` },
                              { l: "fiber", v: `${r.perServing.fiber} g` },
                            ].map((x) => (
                              <div key={x.l}>
                                <dd className="tnum text-sm font-medium">{x.v}</dd>
                                <dt className="text-[10px] text-muted">{x.l}</dt>
                              </div>
                            ))}
                          </dl>
                          <ul className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
                            {r.items.map((it, i) => (
                              <li
                                key={i}
                                className="flex items-baseline gap-2 text-xs text-muted"
                              >
                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                  {it.name}
                                </span>
                                <span className="tnum">{it.grams} g</span>
                                <span className="tnum w-10 text-right">
                                  {it.kcal}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                            <label className="flex items-center gap-1.5 text-[11px] text-muted">
                              Log
                              <input
                                type="number"
                                min={0.25}
                                max={20}
                                step={0.25}
                                inputMode="decimal"
                                value={n}
                                onChange={(e) =>
                                  setServingsFor((p) => ({
                                    ...p,
                                    [r.id]: e.target.value,
                                  }))
                                }
                                className="tnum min-h-9 w-16 rounded border border-border bg-background px-1.5 text-right"
                                aria-label={`Servings of ${r.name}`}
                              />
                              servings
                            </label>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(r.id, () => deleteRecipe(r.id))}
                              className="ml-auto min-h-9 px-2 text-[11px] text-muted hover:text-negative"
                            >
                              Delete recipe
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : tab === "detected" ? (
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
          ) : null}
          {error && <p className="mt-2 text-sm text-negative">{error}</p>}
        </div>
      </div>
    </div>
  );
}
