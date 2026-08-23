"use client";

import { useState } from "react";
import Link from "next/link";
import type { MonthDay } from "@/lib/queries";

/**
 * Calendar heatmap of daily scores.
 *
 * Colour job is SEQUENTIAL — one hue, light to dark, encoding magnitude. A score
 * is "how much", not "which category", so the red-to-green banding used on the
 * score chips would be wrong here: it implies category boundaries that a
 * continuous 0–100 score doesn't have, and a rainbow across a grid is the
 * hardest thing to read under colour-vision deficiency.
 *
 * The ramp is validated (monotone lightness, adjacent ΔL ≥ 0.06, light end
 * ≥ 2:1 on surface, single hue) in both modes — see globals.css.
 */

/** Five equal buckets across 0–100. */
function bucket(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score < 20) return 1;
  if (score < 40) return 2;
  if (score < 60) return 3;
  if (score < 80) return 4;
  return 5;
}

const BUCKET_CLASS: Record<number, string> = {
  1: "bg-heat-1",
  2: "bg-heat-2",
  3: "bg-heat-3",
  4: "bg-heat-4",
  5: "bg-heat-5",
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthHeatmap({ days }: { days: MonthDay[] }) {
  const [hovered, setHovered] = useState<MonthDay | null>(null);

  if (days.length === 0) return null;

  // Pad the first week so the 1st lands under its real weekday.
  const firstDow = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const leading = Array.from({ length: firstDow }, (_, i) => `pad-${i}`);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Daily scores</h2>
        {/* Legend: always present, and the scale is ordered so the ramp reads. */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <span>0</span>
          {[1, 2, 3, 4, 5].map((b) => (
            <span
              key={b}
              className={`h-3 w-3 rounded-sm ${BUCKET_CLASS[b]}`}
              aria-hidden="true"
            />
          ))}
          <span>100</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d, i) => (
          <div key={`${d}-${i}`} className="text-center text-[10px] text-muted">
            {d}
          </div>
        ))}

        {leading.map((k) => (
          <div key={k} aria-hidden="true" />
        ))}

        {days.map((day) => {
          const dayNum = Number(day.date.slice(8, 10));
          const label =
            day.score === null
              ? day.isFuture
                ? `${day.date}: upcoming`
                : `${day.date}: nothing logged`
              : `${day.date}: score ${day.score}, ${day.kcal} kcal, ${day.mealCount} meals`;

          // A future day is blank; a past untracked day gets the empty tone —
          // visibly different from a low score, which is the point.
          const cellClass =
            day.score === null
              ? day.isFuture
                ? "bg-transparent border border-dashed border-border"
                : "bg-heat-empty"
              : BUCKET_CLASS[bucket(day.score)];

          const inner = (
            <span
              className={`grid aspect-square w-full place-items-center rounded-md text-[11px] tnum transition-transform ${cellClass} ${
                day.score !== null && bucket(day.score) >= 3
                  ? "text-white"
                  : "text-foreground/80"
              } ${day.score !== null ? "hover:scale-110" : ""}`}
            >
              {dayNum}
            </span>
          );

          return (
            <div
              key={day.date}
              // Hit target is the whole cell, larger than the visible mark.
              className="relative"
              onMouseEnter={() => setHovered(day)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(day)}
              onBlur={() => setHovered(null)}
            >
              {day.score === null ? (
                <span title={label} aria-label={label}>
                  {inner}
                </span>
              ) : (
                <Link href={`/day/${day.date}`} title={label} aria-label={label}>
                  {inner}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Hover detail, in text tokens — never the series colour. */}
      <div className="mt-3 min-h-[2.5rem] rounded-md bg-surface-raised px-3 py-2 text-xs">
        {hovered ? (
          hovered.score === null ? (
            <span className="text-muted">
              {new Date(`${hovered.date}T00:00:00Z`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
              {" — "}
              {hovered.isFuture ? "upcoming" : "nothing logged"}
            </span>
          ) : (
            <span>
              <span className="font-medium">
                {new Date(`${hovered.date}T00:00:00Z`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </span>
              <span className="tnum text-muted">
                {" — "}score {hovered.score} · {hovered.kcal} kcal ·{" "}
                {hovered.protein} g protein · {hovered.mealCount}{" "}
                {hovered.mealCount === 1 ? "meal" : "meals"}
              </span>
            </span>
          )
        ) : (
          <span className="text-muted">
            Hover a day for detail. Click to open it.
          </span>
        )}
      </div>
    </div>
  );
}
