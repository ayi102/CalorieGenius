"use client";

import { useState } from "react";
import { EntryBox } from "./entry-box";
import { EntryCard } from "./entry-card";
import { RecipePicker } from "./recipe-picker";
import type { DayEntryView, RecipeView, RememberedMeal } from "@/lib/queries";

/**
 * The main screen: prompt, saved-meal shortcut, and today's meals together.
 *
 * These were previously split across two tabs, which meant you could not see
 * what you had eaten while adding to it. They belong on one page — the entry box
 * has to stay visible, because a tracker whose input is one tap away is a
 * tracker that gets used.
 */
export function TodayLog({
  entries,
  recipes,
  meals,
  parsesRemaining,
}: {
  entries: DayEntryView[];
  recipes: RecipeView[];
  meals: RememberedMeal[];
  parsesRemaining: number;
}) {
  const [picking, setPicking] = useState(false);
  const hasSaved = recipes.length > 0 || meals.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {picking && (
        <RecipePicker
          recipes={recipes}
          meals={meals}
          onClose={() => setPicking(false)}
        />
      )}

      <EntryBox
        parsesRemaining={parsesRemaining}
        knownMeals={meals.map((m) => ({
          entryId: m.entryId,
          rawText: m.rawText,
          kcal: m.kcal,
          timesLogged: m.timesLogged,
        }))}
      />

      {/* Quiet by design: a dashed tile, not a second panel competing with the
          entry box. Only shown once there is actually something saved. */}
      {hasSaved && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-sm text-muted transition-colors hover:border-accent hover:text-foreground"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            +
          </span>
          Add a meal you&apos;ve had before
          <span className="tnum text-xs opacity-70">({meals.length})</span>
        </button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          {entries.length === 0
            ? "Today"
            : `Today · ${entries.length} ${entries.length === 1 ? "meal" : "meals"}`}
        </h2>

        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            Nothing logged yet. Type what you ate above, or pick something you&apos;ve
            had before.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
