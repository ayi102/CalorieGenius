"use client";

import { useState } from "react";

/**
 * Segmented tabs.
 *
 * The Today screen previously stacked an entry box, a re-log list, four stat
 * tiles, the day's meals and a score breakdown into one column — far too much to
 * take in, especially on a phone. Splitting it means each view answers one
 * question.
 *
 * State is local rather than in the URL: switching tabs is a glance, not a
 * navigation, and putting it in the URL would add a history entry every time
 * someone looked at their score.
 */
export function Tabs({
  tabs,
  initial,
}: {
  tabs: { id: string; label: string; badge?: string; content: React.ReactNode }[];
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="flex flex-col gap-4">
      {/* The control is a scrollable row so a fifth tab never wraps awkwardly. */}
      <div
        role="tablist"
        aria-label="View"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5"
      >
        {tabs.map((t) => {
          const isActive = t.id === current?.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`panel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`min-h-10 shrink-0 rounded-full px-3.5 text-sm transition-colors ${
                isActive
                  ? "bg-accent font-medium text-accent-fg"
                  : "border border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {t.badge && (
                <span
                  className={`tnum ml-1.5 text-xs ${
                    isActive ? "opacity-70" : "opacity-60"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${current?.id}`}
        aria-labelledby={`tab-${current?.id}`}
      >
        {current?.content}
      </div>
    </div>
  );
}
