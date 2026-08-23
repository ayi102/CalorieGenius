"use client";

import { useState } from "react";
import { scoreBand, type MealScore } from "@/lib/scoring";

const BAND_CLASS: Record<string, string> = {
  none: "bg-score-none text-muted",
  poor: "bg-score-poor text-white",
  ok: "bg-score-ok text-white",
  good: "bg-score-good text-white",
  great: "bg-score-great text-white",
};

/**
 * A meal's score: the number, a one-line reason, and an expandable breakdown.
 *
 * The headline is always visible because a bare number is not actionable — the
 * point is to know *why* without having to press anything. Expanding is for when
 * you want the arithmetic.
 */
export function MealScoreChip({ score }: { score: MealScore | null }) {
  const [open, setOpen] = useState(false);
  if (!score) return null;

  const band = scoreBand(score.total);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-raised"
      >
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded text-xs font-semibold tnum ${BAND_CLASS[band]}`}
        >
          {score.total}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {score.headline}
        </span>
        <span
          className="shrink-0 text-[10px] text-muted"
          aria-hidden="true"
        >
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-1 rounded-md bg-surface-raised p-2">
          <ul className="flex flex-col gap-1.5">
            {score.components.map((c) => {
              const pct = (c.earned / c.max) * 100;
              return (
                <li key={c.key}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="font-medium">{c.label}</span>
                    <span className="tnum text-muted">
                      {c.earned} / {c.max}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 h-1 overflow-hidden rounded-full bg-border"
                    role="img"
                    aria-label={`${c.label}: ${c.earned} of ${c.max} points`}
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{c.detail}</p>
                </li>
              );
            })}
          </ul>

          <p className="mt-2 border-t border-border pt-1.5 text-[11px] text-muted tnum">
            {score.totals.kcal} kcal · {score.totals.protein} g protein ·{" "}
            {score.totals.carbs} g carbs · {score.totals.fat} g fat ·{" "}
            {score.totals.fiber} g fiber
          </p>
          <p className="mt-1 text-[10px] text-muted">
            A meal is judged on what&apos;s intrinsic to it — how processed it is,
            protein and fiber per calorie, and whether its size suits the slot.
            Your daily calorie total is scored separately.
          </p>
        </div>
      )}
    </div>
  );
}
