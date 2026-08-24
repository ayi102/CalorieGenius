import type { DayScore } from "@/lib/scoring";
import { scoreBand } from "@/lib/scoring";
import { formatVolume, type UnitSystem } from "@/lib/units";

const BAND_CLASS: Record<string, string> = {
  none: "text-muted",
  poor: "text-negative",
  ok: "text-warning",
  good: "text-foreground",
  great: "text-positive",
};

/**
 * The always-visible header for a day: calories against target, protein, score.
 *
 * Sits above the tabs because it is the one thing worth seeing regardless of
 * which view is open — hiding today's calorie total behind a tab would defeat
 * the point of the app.
 */
export function DaySummary({
  score,
  targets,
  waterMl,
  waterTargetMl,
  units,
}: {
  score: DayScore | null;
  targets: { kcal: number; protein: number };
  waterMl: number;
  waterTargetMl: number;
  units: UnitSystem;
}) {
  const kcal = score?.totals.kcal ?? 0;
  const protein = score?.totals.protein ?? 0;
  const remaining = targets.kcal - kcal;
  const pct = Math.min(100, (kcal / targets.kcal) * 100);

  return (
    <section className="card p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Calories</p>
          <p className="display mt-1 text-4xl leading-none tnum">
            {kcal.toLocaleString()}
            <span className="ml-1.5 font-sans text-base text-muted">
              / {targets.kcal.toLocaleString()}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-muted tnum">
            {remaining >= 0
              ? `${remaining.toLocaleString()} left`
              : `${Math.abs(remaining).toLocaleString()} over`}
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted">Score</p>
          <p
            className={`display mt-1 text-4xl leading-none tnum ${BAND_CLASS[scoreBand(score?.total ?? null)]}`}
          >
            {score?.total ?? "—"}
          </p>
          <p className="mt-1.5 text-xs text-muted tnum">
            {protein} / {targets.protein} g protein
          </p>
        </div>
      </div>

      {/* One thin track, not four competing meters. */}
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
          role="img"
          aria-label={`${kcal} of ${targets.kcal} calories`}
        />
      </div>

      {/* The rest of the day's tallies, at a glance — protein is above, so this
          row carries what the tabs would otherwise hide. */}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
        <div>
          <dt className="text-xs text-muted">Carbs</dt>
          <dd className="tnum mt-0.5 text-sm font-medium">
            {score?.totals.carbs ?? 0} g
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Fiber</dt>
          <dd className="tnum mt-0.5 text-sm font-medium">
            {score?.totals.fiber ?? 0} g
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Water</dt>
          <dd className="tnum mt-0.5 text-sm font-medium">
            {formatVolume(waterMl, units)}
            <span className="ml-1 font-normal text-muted">
              / {formatVolume(waterTargetMl, units)}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
