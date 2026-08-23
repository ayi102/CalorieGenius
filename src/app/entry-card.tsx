"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  correctItem,
  deleteEntry,
  deleteItem,
  updateEntryTime,
  updateItemGrams,
} from "@/lib/actions";
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

  const [grams, setGrams] = useState(Math.round(item.grams));
  const [form, setForm] = useState(pristine);

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
    setGrams(Math.round(item.grams));
    setForm(pristine);
  }

  // Escape closes, and so does a tap anywhere outside the row — the two things
  // people reflexively try when they opened something by accident.
  useEffect(() => {
    if (!expanded) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    function onPointerDown(e: PointerEvent) {
      if (!rowRef.current?.contains(e.target as Node)) dismiss();
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
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
          className="min-w-0 flex-1 truncate text-left hover:text-foreground"
          aria-expanded={expanded}
        >
          <span className={expanded ? "text-foreground" : "text-muted"}>
            {item.name}
          </span>
          <span className="text-muted/70"> · {Math.round(item.grams)} g</span>
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
          <p className="text-[10px] text-muted">
            Nothing is saved until you press a button — Esc or a tap outside
            discards.
          </p>
          {/* Fast path: just fix the portion. Nutrition rescales with it. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">Portion</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={grams}
                  onChange={(e) => setGrams(Number(e.target.value))}
                  className="tnum w-20 rounded border border-border bg-background px-1.5 py-1 text-right text-xs"
                  aria-label="Grams"
                />
                <span className="text-[11px] text-muted">g</span>
              </div>
            </label>
            <button
              type="button"
              disabled={pending || grams === Math.round(item.grams)}
              onClick={() => run(() => updateItemGrams(item.id, grams))}
              className="rounded bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg disabled:opacity-50"
            >
              Rescale
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="ml-auto rounded border border-border px-2 py-1.5 text-[11px] text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteItem(item.id))}
              className="rounded border border-border px-2 py-1.5 text-[11px] text-muted hover:text-negative"
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
                      {k === "kcal" ? "kcal" : `${k} g`}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={form[k]}
                      onChange={(e) =>
                        setForm({ ...form, [k]: Number(e.target.value) })
                      }
                      className="tnum rounded border border-border bg-background px-1 py-1 text-right text-xs"
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
                      grams,
                      kcal: form.kcal,
                      protein: form.protein,
                      carbs: form.carbs,
                      fat: form.fat,
                    }),
                  )
                }
                className="self-start rounded bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg disabled:opacity-50"
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

  const kcal = entry.items.reduce((s, i) => s + i.kcal, 0);

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">
          {MEAL_LABEL[entry.mealType] ?? entry.mealType}
        </span>

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

        <span className="tnum ml-auto text-sm">{Math.round(kcal)} kcal</span>

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

      <p className="mt-1.5 text-[11px] text-muted">Tap an item to fix it.</p>
    </li>
  );
}
