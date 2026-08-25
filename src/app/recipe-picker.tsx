"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  combineFoods,
  deleteRecipe,
  hideFood,
  logRecipe,
  quickAddFood,
  relogEntry,
} from "@/lib/actions";
import type { RecipeView, RememberedFood, RememberedMeal } from "@/lib/queries";
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
  foods,
  onClose,
}: {
  recipes: RecipeView[];
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
  /**
   * Three tabs, because they are three different kinds of thing:
   *   mine     — recipes she declared and named. Intent, not inference.
   *   detected — repeated multi-item meals the app noticed in her log.
   *   prompts  — single foods and one-offs; not really recipes at all.
   *
   * Opens on whichever has content, preferring her own.
   */
  const [tab, setTab] = useState<"mine" | "detected" | "prompts">(
    recipes.length > 0 ? "mine" : meals.length > 0 ? "detected" : "prompts",
  );
  const [servingsFor, setServingsFor] = useState<Record<string, string>>({});

  /**
   * Combine mode.
   *
   * Exists because anything logged before composites were kept whole left its
   * ingredients in the library as separate rows — "espresso", "ground cinnamon",
   * "chocolate milk" rather than "latte". Selecting them and giving them one
   * name fixes the list without losing the nutrition already worked out.
   */
  const [showComponents, setShowComponents] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [combineName, setCombineName] = useState("");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
  const shownMeals = needle
    ? meals.filter((m) => m.rawText.toLowerCase().includes(needle))
    : meals;
  const matchedFoods = needle
    ? foods.filter((f) => f.displayName.toLowerCase().includes(needle))
    : foods;

  /**
   * Split by what the log already knows.
   *
   * A food she has eaten on its own is something she chooses; one that has only
   * ever appeared inside a meal is a component of it, and the meal — which
   * carries the words she typed — is the better thing to re-log. Deriving this
   * means she never has to tell the app which is which.
   */
  const standalone = matchedFoods.filter((f) => f.soloCount > 0);
  const components = matchedFoods.filter((f) => f.soloCount === 0);
  const shownFoods = showComponents ? components : standalone;

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
                ["detected", "Detected Recipes", meals.length],
                ["prompts", "Prompts", foods.length],
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
          ) : matchedFoods.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {foods.length === 0
                ? "Nothing saved yet."
                : "No match."}
            </p>
          ) : (
            <>
              {/* Where the one-tap answer actually lives. */}
              {components.length > 0 && (
                <div className="mb-3 rounded-lg bg-surface-raised p-3">
                  <p className="text-xs text-muted">
                    {showComponents
                      ? `These ${components.length} only ever appeared inside a meal. To log the whole thing in one tap, use the Meals list.`
                      : `${components.length} more are parts of meals rather than things you've eaten alone — the Meals list logs those in one tap.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowComponents((v) => !v)}
                    className="mt-1.5 min-h-8 text-xs font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
                  >
                    {showComponents
                      ? "Back to foods you eat on their own"
                      : `Show meal parts (${components.length})`}
                  </button>
                </div>
              )}

              <div className="mb-2 flex flex-wrap items-center gap-2">
                {!selecting ? (
                  <button
                    type="button"
                    onClick={() => setSelecting(true)}
                    className="min-h-9 rounded-full border border-border px-3 text-xs text-muted hover:text-foreground"
                  >
                    Combine ingredients into one
                  </button>
                ) : (
                  <>
                    <input
                      value={combineName}
                      onChange={(e) => setCombineName(e.target.value)}
                      placeholder="Name it, e.g. Latte"
                      aria-label="Name for the combined food"
                      className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
                    />
                    <button
                      type="button"
                      disabled={
                        pending || selected.size < 2 || combineName.trim().length < 2
                      }
                      onClick={() =>
                        run("combine", async () => {
                          const r = await combineFoods(
                            [...selected],
                            combineName,
                          );
                          if (r.ok) {
                            setSelecting(false);
                            setSelected(new Set());
                            setCombineName("");
                          }
                          return r;
                        })
                      }
                      className="min-h-9 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
                    >
                      {busy === "combine" ? "…" : `Combine ${selected.size}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelecting(false);
                        setSelected(new Set());
                        setCombineName("");
                      }}
                      className="min-h-9 rounded-md border border-border px-2.5 text-xs text-muted"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
              {selecting && (
                <p className="mb-2 text-[11px] text-muted">
                  Tick the ingredients that make up one thing — their nutrition is
                  added together and they leave this list.
                </p>
              )}
              {shownFoods.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  Nothing here yet — everything you&apos;ve logged came as part of
                  a meal.
                </p>
              )}
              <ul className="flex flex-col divide-y divide-border">
              {shownFoods.map((f) => {
                const expanded = open === f.id;
                return (
                  <li key={f.id} className="py-2.5">
                    <div className="flex items-start gap-2">
                      {selecting && (
                        <input
                          type="checkbox"
                          checked={selected.has(f.id)}
                          onChange={() => toggle(f.id)}
                          aria-label={`Select ${f.displayName}`}
                          className="mt-1 h-4 w-4 shrink-0"
                        />
                      )}
                      {/* Same affordance as a meal: tap the name for nutrition,
                          tap Add to log it. A single food is often a composite
                          — a latte, a smoothie — so its macros matter just as
                          much as a multi-item meal's. */}
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : f.id)}
                        aria-expanded={expanded}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="text-sm [overflow-wrap:anywhere]">
                          {f.displayName}
                          {f.brand && (
                            <span className="text-muted"> · {f.brand}</span>
                          )}
                        </p>
                        <p className="tnum mt-0.5 text-xs text-muted">
                          {f.kcalForDefault} cal ·{" "}
                          {f.unitIsServing
                            ? "1 serving"
                            : `${Math.round(f.defaultGrams)} g`}
                          {f.timesLogged > 1 && ` · ${f.timesLogged}×`}
                        </p>
                      </button>
                      {!selecting && (
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
                      )}
                    </div>

                    {expanded && (
                      <div className="mt-2 rounded-lg bg-surface-raised p-3">
                        <dl className="grid grid-cols-4 gap-2 text-center">
                          {[
                            { l: "cal", v: f.kcalForDefault },
                            { l: "protein", v: `${f.proteinForDefault} g` },
                            { l: "carbs", v: `${f.carbsForDefault} g` },
                            { l: "fat", v: `${f.fatForDefault} g` },
                          ].map((x) => (
                            <div key={x.l}>
                              <dd className="tnum text-sm font-medium">{x.v}</dd>
                              <dt className="text-[10px] text-muted">{x.l}</dt>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-2 flex items-baseline justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted">
                          <span>
                            {f.fiberForDefault > 0 &&
                              `${f.fiberForDefault} g fiber · `}
                            {f.foodGroup.replace("_", " ")} · level{" "}
                            {f.processedLevel}
                          </span>
                          <span>
                            {f.nutritionSource === "usda"
                              ? "USDA"
                              : f.nutritionSource === "openfoodfacts"
                                ? "label"
                                : f.nutritionSource === "user"
                                  ? "yours"
                                  : "estimate"}
                          </span>
                        </p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-muted">
                            Per{" "}
                            {f.unitIsServing
                              ? "serving"
                              : `${Math.round(f.defaultGrams)} g portion`}
                            . Adjust after adding.
                          </p>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(f.id, () => hideFood(f.id))}
                            className="min-h-8 shrink-0 px-2 text-[10px] text-muted hover:text-negative"
                          >
                            Hide from this list
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
              </ul>
            </>
          )}

          {error && <p className="mt-2 text-sm text-negative">{error}</p>}
        </div>
      </div>
    </div>
  );
}
