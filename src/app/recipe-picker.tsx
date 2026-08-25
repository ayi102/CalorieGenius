"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteRecipe,
  logRecipe,
  promoteMealToRecipe,
  relogEntry,
  updateRecipe,
} from "@/lib/actions";
import type { RecipeView, RememberedMeal } from "@/lib/queries";
import { scoreBand } from "@/lib/scoring";
import { useScrollLock } from "@/app/use-scroll-lock";

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
  const [tab, setTab] = useState<"mine" | "detected">(
    recipes.length > 0 ? "mine" : "detected",
  );
  /** Name being typed when promoting a detected meal, keyed by entry id. */
  const [promoting, setPromoting] = useState<Record<string, string>>({});
  /** Recipe currently open in the editor. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    servings: string;
    grams: Record<string, string>;
  } | null>(null);
  const [servingsFor, setServingsFor] = useState<Record<string, string>>({});


  useScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) {
        setError(r.error ?? "Could not do that.");
        return;
      }
      router.refresh();
      // Editing and promoting keep the sheet open — only logging is "done".
      const staysOpen =
        key.startsWith("edit-") || key.startsWith("promote-") || key === "combine";
      if (!staysOpen) onClose();
    });
  }

  const needle = query.trim().toLowerCase();
  const shownRecipes = needle
    ? recipes.filter((r) => r.name.toLowerCase().includes(needle))
    : recipes;

  // Search covers the title AND the original text, so an old prompt is still
  // findable once the card is titled.
  const shownMeals = needle
    ? meals.filter(
        (m) =>
          m.title.toLowerCase().includes(needle) ||
          m.rawText.toLowerCase().includes(needle),
      )
    : meals;


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
        className="relative flex max-h-[85vh] max-h-[85dvh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-raised sm:max-w-lg sm:rounded-2xl"
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
                ["detected", "Detected Recipes", meals.length],
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

        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-3">
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
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
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
                              onClick={() => {
                                setEditing(editing === r.id ? null : r.id);
                                setDraft({
                                  name: r.name,
                                  servings: String(r.servings),
                                  // Editor works in BATCH grams; the list shows
                                  // per-serving, so scale back up.
                                  grams: Object.fromEntries(
                                    r.items.map((it) => [
                                      it.id,
                                      String(Math.round(it.grams * r.servings)),
                                    ]),
                                  ),
                                });
                              }}
                              className="min-h-9 rounded border border-border px-2.5 text-[11px] hover:border-accent"
                            >
                              {editing === r.id ? "Close" : "Edit"}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(r.id, () => deleteRecipe(r.id))}
                              className="ml-auto min-h-9 px-2 text-[11px] text-muted hover:text-negative"
                            >
                              Delete
                            </button>
                          </div>

                          {editing === r.id && draft && (
                            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
                              <div className="flex gap-2">
                                <label className="flex min-w-0 flex-1 flex-col gap-1">
                                  <span className="text-[10px] text-muted">Name</span>
                                  <input
                                    value={draft.name}
                                    onChange={(e) =>
                                      setDraft({ ...draft, name: e.target.value })
                                    }
                                    className="min-h-9 w-full rounded border border-border bg-background px-2 text-xs"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[10px] text-muted">Makes</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    step="any"
                                    inputMode="decimal"
                                    value={draft.servings}
                                    onChange={(e) =>
                                      setDraft({ ...draft, servings: e.target.value })
                                    }
                                    className="tnum min-h-9 w-16 rounded border border-border bg-background px-1.5 text-right text-xs"
                                  />
                                </label>
                              </div>

                              <p className="text-[10px] text-muted">
                                Ingredient weights for the whole batch. Set one to
                                0 to remove it.
                              </p>
                              {r.items.map((it) => (
                                <div key={it.id} className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate text-[11px]">
                                    {it.name}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    inputMode="decimal"
                                    value={draft.grams[it.id] ?? ""}
                                    onChange={(e) =>
                                      setDraft({
                                        ...draft,
                                        grams: {
                                          ...draft.grams,
                                          [it.id]: e.target.value,
                                        },
                                      })
                                    }
                                    className="tnum min-h-9 w-20 rounded border border-border bg-background px-1.5 text-right text-[11px]"
                                    aria-label={`Grams of ${it.name}`}
                                  />
                                  <span className="text-[10px] text-muted">g</span>
                                </div>
                              ))}

                              <button
                                type="button"
                                disabled={pending || draft.name.trim().length < 2}
                                onClick={() =>
                                  run(`edit-${r.id}`, async () => {
                                    const res = await updateRecipe({
                                      recipeId: r.id,
                                      name: draft.name,
                                      servings: Number(draft.servings) || 1,
                                      itemGrams: Object.fromEntries(
                                        Object.entries(draft.grams).map(([k, v]) => [
                                          k,
                                          Number(v) || 0,
                                        ]),
                                      ),
                                    });
                                    if (res.ok) {
                                      setEditing(null);
                                      setDraft(null);
                                    }
                                    return res;
                                  })
                                }
                                className="min-h-9 self-start rounded bg-accent px-3 text-[11px] font-medium text-accent-fg disabled:opacity-50"
                              >
                                {busy === `edit-${r.id}` ? "…" : "Save changes"}
                              </button>
                            </div>
                          )}
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
                          <p className="text-sm font-medium [overflow-wrap:anywhere]">
                            {m.title}
                          </p>
                          <p className="tnum mt-0.5 text-xs text-muted">
                            {m.kcal} cal · {m.protein} g protein ·{" "}
                            {m.itemCount} {m.itemCount === 1 ? "ingredient" : "ingredients"}
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
                          {m.rawText !== m.title && (
                            <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted [overflow-wrap:anywhere]">
                              You typed: {m.rawText}
                            </p>
                          )}

                          {/* Detected meals shift as history changes; saving
                              one pins it so it can be renamed and portioned. */}
                          <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                            <input
                              value={promoting[m.entryId] ?? m.title}
                              onChange={(e) =>
                                setPromoting((p) => ({
                                  ...p,
                                  [m.entryId]: e.target.value,
                                }))
                              }
                              aria-label="Recipe name"
                              className="min-h-9 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
                            />
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(`promote-${m.entryId}`, async () => {
                                  const r = await promoteMealToRecipe(
                                    m.entryId,
                                    promoting[m.entryId] ?? m.title,
                                  );
                                  if (r.ok) setTab("mine");
                                  return r;
                                })
                              }
                              className="min-h-9 shrink-0 rounded border border-border px-2.5 text-[11px] font-medium hover:border-accent"
                            >
                              {busy === `promote-${m.entryId}`
                                ? "…"
                                : "Save as recipe"}
                            </button>
                          </div>
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
