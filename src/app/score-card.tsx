import type { DayScore } from "@/lib/scoring";
import { scoreBand } from "@/lib/scoring";

const BAND_CLASS: Record<string, string> = {
  none: "bg-score-none text-muted",
  poor: "bg-score-poor text-white",
  ok: "bg-score-ok text-white",
  good: "bg-score-good text-white",
  great: "bg-score-great text-white",
};

/**
 * The score, always shown WITH its components.
 *
 * A bare number tells you nothing actionable; "you hit calories and protein but
 * lost points on late-night eating" is the actual product.
 */
export function ScoreCard({ score }: { score: DayScore | null }) {
  if (!score) {
    return (
      <div className="card p-4">
        <div className="text-xs text-muted">Score</div>
        <div className="mt-1 text-2xl font-semibold text-muted">—</div>
        <p className="mt-1 text-xs text-muted">
          Nothing logged yet. An untracked day isn&apos;t a bad day, so it doesn&apos;t
          count against your month.
        </p>
      </div>
    );
  }

  const band = scoreBand(score.total);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg text-lg font-semibold tnum ${BAND_CLASS[band]}`}
        >
          {score.total}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">Today&apos;s score</div>
          <div className="text-xs text-muted">out of 100</div>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {score.components.map((c) => {
          const pct = (c.earned / c.max) * 100;
          return (
            <li key={c.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">{c.label}</span>
                <span className="tnum text-muted">
                  {c.earned} / {c.max}
                </span>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-raised"
                role="img"
                aria-label={`${c.label}: ${c.earned} of ${c.max} points`}
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted">{c.detail}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
