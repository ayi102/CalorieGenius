"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addItemToEntry,
  correctItem,
  deleteEntry,
  deleteItem,
  updateEntryTime,
  updateItemAmount,
} from "@/lib/actions";
import { fromGrams, unitChoices } from "@/lib/nutrition/units";
import type { DayEntryView, DayItemView } from "@/lib/queries";
import { formatLocalMinutes } from "@/lib/time";
import { MealScoreChip } from "./score-chip";

const MEAL_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/** datetime-local value for an instant, in the browser's clock. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One saved item, editable in place.
 *
 * Two levels of correction, because they are different problems: nudging the
 * portion (common, and the biggest error source) versus overriding the numbers
 * outright (rarer, for when the parse was simply wrong).
 */
function ItemRow({ item }: { item: DayItemView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  const pristine = {
    name: item.name,
    kcal: Math.round(item.kcal),
    protein: Math.round(item.protein),
    carbs: Math.round(item.carbs),
    fat: Math.round(item.fat),
  };

  /**
   * How this food can be measured.
   *
   * Food-specific, because a cup of rice is 160 g and a cup of spinach is 30 g.
   * The options come from the parser and are stored on the row, with weight
   * units always available and the unit actually logged recovered from the row
   * itself for older entries that predate this.
   */
  const choices = unitChoices(
    item.unitOptions,
    item.unit,
    item.grams,
    item.quantity,
  );
  const currentUnit =
    choices.find((c) => c.unit === item.unit.trim().toLowerCase()) ?? choices[0];

  const [unit, setUnit] = useState(currentUnit?.unit ?? "g");
  const [amount, setAmount] = useState(
    currentUnit ? fromGrams(item.grams, currentUnit) : Math.round(item.grams),
  );
  const [form, setForm] = useState(pristine);

  const selected = choices.find((c) => c.unit === unit) ?? currentUnit;

  /**
   * Close without saving, throwing away any half-typed edits.
   *
   * Backing out has to actually back out: leaving the values behind would mean
   * reopening the row shows numbers that were never saved, which reads as if
   * they were.
   */
  function dismiss() {
    setExpanded(false);
    setError(null);
    setUnit(currentUnit?.unit ?? "g");
    setAmount(currentUnit ? fromGrams(item.grams, currentUnit) : Math.round(item.grams));
    setForm(pristine);
  }

  /**
   * Escape closes, and so does a TAP outside the row.
   *
   * Deliberately not on `pointerdown`: that fires the instant a finger touches
   * the screen, including when starting to scroll, so the panel collapsed the
   * moment anyone tried to scroll the page. On a phone that is indistinguishable
   * from "scrolling is broken".
   *
   * So the gesture is only treated as a dismissing tap if the pointer went down
   * outside the row AND came back up within a few pixels. A drag of any distance
   * is a scroll, and leaves the panel open.
   */
  useEffect(() => {
    if (!expanded) return;

    let startedOutside = false;
    let dragged = false;
    let startX = 0;
    let startY = 0;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    function onPointerDown(e: PointerEvent) {
      startedOutside = !rowRef.current?.contains(e.target as Node);
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
    }
    /**
     * Movement is tracked here rather than by comparing coordinates on pointerup.
     * A pointerup does not reliably carry the final position — a synthesized
     * touch end can report 0,0 — and a tap would then look like a 300px drag and
     * never dismiss.
     */
    function onPointerMove(e: PointerEvent) {
      if (!startedOutside || dragged) return;
      // 10px of slop: a finger never lands and lifts perfectly still.
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) dragged = true;
    }
    function onPointerUp() {
      const wasTap = startedOutside && !dragged;
      startedOutside = false;
      dragged = false;
      if (wasTap) dismiss();
    }
    // A scroll the browser takes over cancels the pointer; that is never a tap.
    function onCancel() {
      startedOutside = false;
      dragged = false;
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onCancel);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const isEstimate = item.nutritionSource === "estimate";
  const isCorrected = item.nutritionSource === "user";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Could not save.");
      else {
        setExpanded(false);
        router.refresh();
      }
    });
  }

  return (
    <li ref={rowRef} className="py-1.5">
      <div className="flex items-baseline gap-2 text-xs">
        <button
          type="button"
          onClick={() => (expanded ? dismiss() : setExpanded(true))}
          // min-h-9 makes the whole row a comfortable tap target rather than a
          // 12px line of text.
          // Wraps to two lines rather than truncating: barcode product names are long,
          // and an unreadable name defeats the point of a confirmation step.
          className="min-h-9 min-w-0 flex-1 text-left [overflow-wrap:anywhere] hover:text-foreground"
          aria-expanded={expanded}
        >
          <span className={expanded ? "text-foreground" : "text-muted"}>
            {item.name}
          </span>
          <span className="text-muted/70">
            {" · "}
            {Number(item.quantity.toFixed(2))} {item.unit}
            {item.unit !== "g" && ` (${Math.round(item.grams)} g)`}
          </span>
          {isEstimate && (
            <span className="ml-1 text-warning" title="Estimated — no database match">
              ~
            </span>
          )}
          {isCorrected && (
            <span className="ml-1 text-accent" title="You corrected this">
              ✓
            </span>
          )}
        </button>
        <span className="tnum text-muted">{Math.round(item.kcal)}</span>
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-surface-raised p-2">
          {/* Nutrition first: for a composite item this is what you opened it
              to see, not the edit controls. */}
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              { l: "cal", v: Math.round(item.kcal) },
              { l: "protein", v: `${Math.round(item.protein)} g` },
              { l: "carbs", v: `${Math.round(item.carbs)} g` },
              { l: "fat", v: `${Math.round(item.fat)} g` },
            ].map((x) => (
              <div key={x.l}>
                <dd className="tnum text-sm font-medium">{x.v}</dd>
                <dt className="text-[10px] text-muted">{x.l}</dt>
              </div>
            ))}
          </dl>
          <div className="flex items-baseline justify-between gap-2 border-t border-border pt-1.5 text-[11px] text-muted">
            <span>
              {item.fiber > 0 && `${Math.round(item.fiber)} g fiber · `}
              {item.foodGroup.replace("_", " ")} · level {item.processedLevel}
            </span>
            <span>
              {item.nutritionSource === "usda"
                ? "USDA"
                : item.nutritionSource === "openfoodfacts"
                  ? "label"
                  : item.nutritionSource === "user"
                    ? "yours"
                    : "estimate"}
            </span>
          </div>
          <p className="text-[10px] text-muted">
            Nothing is saved until you press a button — Esc or a tap outside
            discards.
          </p>
          {/* Fast path: just fix the portion. Nutrition rescales with it. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">Amount</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="tnum min-h-10 w-20 rounded border border-border bg-background px-2 text-right"
                  aria-label="Amount"
                />
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  aria-label="Unit"
                  className="min-h-10 rounded border border-border bg-background px-1.5 text-xs"
                >
                  {choices.map((c) => (
                    <option key={c.unit} value={c.unit}>
                      {c.unit}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            {selected && unit !== "g" && (
              <span className="pb-2.5 text-[11px] text-muted tnum">
                = {Math.round(amount * selected.gramsPerUnit)} g
              </span>
            )}

            <button
              type="button"
              disabled={pending || !selected || amount <= 0}
              onClick={() =>
                selected &&
                run(() =>
                  updateItemAmount(item.id, amount, selected.unit, selected.gramsPerUnit),
                )
              }
              className="min-h-10 rounded bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
            >
              Update
            </button>

            <button
              type="button"
              onClick={dismiss}
              className="ml-auto min-h-10 rounded border border-border px-3 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteItem(item.id))}
              className="min-h-10 rounded border border-border px-3 text-xs text-muted hover:text-negative"
            >
              Remove
            </button>
          </div>

          {/* Full override, for when the parse got the food itself wrong. */}
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted hover:text-foreground">
              These numbers are wrong
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="rounded border border-border bg-background px-1.5 py-1 text-xs"
                aria-label="Food name"
              />
              <div className="grid grid-cols-4 gap-1">
                {(["kcal", "protein", "carbs", "fat"] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted">
                      {k === "kcal" ? "cal" : `${k} g`}
                    </span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={form[k]}
                      onChange={(e) =>
                        setForm({ ...form, [k]: Number(e.target.value) })
                      }
                      className="tnum min-h-10 w-full rounded border border-border bg-background px-1.5 text-right"
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    correctItem({
                      itemId: item.id,
                      name: form.name,
                      // The override applies to the amount currently selected.
                      grams: selected ? amount * selected.gramsPerUnit : item.grams,
                      kcal: form.kcal,
                      protein: form.protein,
                      carbs: form.carbs,
                      fat: form.fat,
                    }),
                  )
                }
                className="min-h-10 self-start rounded bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
              >
                Save correction
              </button>
              <p className="text-[10px] text-muted">
                Saved as yours: this food will use your numbers next time, and
                nothing automatic will overwrite it.
              </p>
            </div>
          </details>

          {error && <p className="text-[11px] text-negative">{error}</p>}
        </div>
      )}
    </li>
  );
}

export function EntryCard({ entry }: { entry: DayEntryView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editingTime, setEditingTime] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(new Date(entry.eatenAt)));
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const kcal = entry.items.reduce((s, i) => s + i.kcal, 0);

  return (
    <li className="card p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* The dish name leads; the meal slot is context, not the headline. */}
        <span className="text-sm font-medium">
          {entry.title ?? MEAL_LABEL[entry.mealType] ?? entry.mealType}
        </span>
        {entry.title && (
          <span className="text-xs text-muted">
            {MEAL_LABEL[entry.mealType] ?? entry.mealType}
          </span>
        )}

        {editingTime ? (
          <span className="flex items-center gap-1">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await updateEntryTime(entry.id, new Date(when).toISOString());
                  setEditingTime(false);
                  router.refresh();
                })
              }
              className="rounded bg-accent px-2 py-0.5 text-[11px] text-accent-fg"
            >
              Set
            </button>
            <button
              type="button"
              onClick={() => {
                // Revert to the stored time, not whatever was typed.
                setWhen(toLocalInput(new Date(entry.eatenAt)));
                setEditingTime(false);
              }}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditingTime(true)}
            className="text-xs text-muted underline decoration-dotted hover:text-foreground"
            title="Change the time"
          >
            {formatLocalMinutes(entry.localMinutes)}
          </button>
        )}

        {entry.restaurantName && (
          <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[11px] text-muted">
            {entry.restaurantName}
          </span>
        )}

        <span className="tnum ml-auto text-sm">{Math.round(kcal)} cal</span>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await deleteEntry(entry.id);
              router.refresh();
            })
          }
          className="text-xs text-muted hover:text-negative disabled:opacity-50"
          aria-label="Delete this meal"
        >
          delete
        </button>
      </div>

      <MealScoreChip score={entry.score} />

      <ul className="mt-1 flex flex-col divide-y divide-border/60">
        {entry.items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>

      {/* Adding runs the same parse-and-ground pipeline as a new meal, so
          "2 tbsp peanut butter" arrives with real nutrition rather than needing
          the numbers typed in. */}
      {adding ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = addText.trim();
            if (text.length < 2) return;
            setAddError(null);
            start(async () => {
              const r = await addItemToEntry(entry.id, text);
              if (!r.ok) {
                setAddError(r.error ?? "Could not add that.");
                return;
              }
              setAddText("");
              setAdding(false);
              router.refresh();
            });
          }}
        >
          <input
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            autoFocus
            placeholder="2 tbsp peanut butter"
            aria-label="Ingredient to add"
            className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs"
          />
          <button
            type="submit"
            disabled={pending || addText.trim().length < 2}
            className="min-h-10 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
          >
            {pending ? "…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setAddText("");
              setAddError(null);
            }}
            className="min-h-10 shrink-0 rounded-md border border-border px-2.5 text-xs text-muted"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 min-h-9 rounded-md border border-dashed border-border-strong px-3 text-xs text-muted hover:border-accent hover:text-foreground"
        >
          + Add an ingredient
        </button>
      )}

      {addError && <p className="mt-1.5 text-xs text-negative">{addError}</p>}

      <p className="mt-1.5 text-[11px] text-muted">
        Tap an item to change its amount, units, or numbers.
      </p>
    </li>
  );
}
