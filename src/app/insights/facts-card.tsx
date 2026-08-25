import type { KnownFacts } from "@/lib/queries";
import { formatVolume, kgToLb, type UnitSystem } from "@/lib/units";

/**
 * Facts, not interpretation.
 *
 * Everything here is arithmetic over her log, so it is exact, instant, free,
 * and available from the first day. Nothing on this card required a model, and
 * nothing on it is an opinion — that is the analysis section's job.
 */
export function FactsCard({
  facts,
  units,
  goal,
}: {
  facts: KnownFacts;
  units: UnitSystem;
  goal: "lose" | "maintain" | "gain";
}) {
  const w = facts.weight;
  const rate = w.ratePerWeekKg;
  const showRate = rate !== null;
  const rateDisplay =
    rate === null
      ? null
      : units === "imperial"
        ? `${kgToLb(rate) > 0 ? "+" : ""}${kgToLb(rate).toFixed(1)} lb/wk`
        : `${rate > 0 ? "+" : ""}${rate.toFixed(2)} kg/wk`;
  const rateGood =
    rate === null
      ? null
      : goal === "lose"
        ? rate < 0
        : goal === "gain"
          ? rate > 0
          : Math.abs(rate) < 0.25;

  const tiles: { label: string; value: string; sub?: string }[] = [
    {
      label: "Calories a day",
      value: facts.avgKcal === null ? "—" : facts.avgKcal.toLocaleString(),
      sub: `target ${facts.targetKcal.toLocaleString()}`,
    },
    {
      label: "Eating out",
      value: facts.eatingOutPct === null ? "—" : `${facts.eatingOutPct}%`,
      sub:
        facts.totalMeals > 0
          ? `${facts.mealsOut} of ${facts.totalMeals} meals`
          : undefined,
    },
    {
      label: showRate ? "Weight trend" : "Weight",
      value: showRate
        ? rateDisplay!
        : w.latestKg === null
          ? "—"
          : units === "imperial"
            ? `${Math.round(kgToLb(w.latestKg))} lb`
            : `${w.latestKg.toFixed(1)} kg`,
      sub: showRate
        ? `from ${w.weighIns} weigh-ins`
        : w.weighIns < 3
          ? "needs 3+ weigh-ins"
          : undefined,
    },
    {
      label: "Days on target",
      value: `${facts.daysOnTarget}`,
      sub: `of ${facts.daysTracked} tracked`,
    },
    {
      label: "Meals a day",
      value: facts.avgMealsPerDay === null ? "—" : String(facts.avgMealsPerDay),
    },
    {
      label: "Protein a day",
      value: facts.avgProtein === null ? "—" : `${facts.avgProtein} g`,
    },
    {
      label: "Fiber a day",
      value: facts.avgFiber === null ? "—" : `${facts.avgFiber} g`,
    },
    {
      label: "Water a day",
      value:
        facts.avgWaterMl === null ? "—" : formatVolume(facts.avgWaterMl, units),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="display text-lg">What we know</h2>
        <p className="mt-0.5 text-xs text-muted">
          Straight from your log, last {facts.windowDays} days ·{" "}
          {facts.daysTracked} tracked
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3">
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd
              className={`display mt-1 text-xl tnum ${
                t.label === "Weight trend" && rateGood !== null
                  ? rateGood
                    ? "text-positive"
                    : "text-foreground"
                  : ""
              }`}
            >
              {t.value}
            </dd>
            {t.sub && <dd className="mt-0.5 text-[11px] text-muted">{t.sub}</dd>}
          </div>
        ))}
      </dl>

      {facts.ultraProcessedPct !== null && (
        <p className="text-xs text-muted">
          {facts.ultraProcessedPct}% of your calories came from ultra-processed
          food.
          {facts.daysWithEatingOut > 0 &&
            ` You ate out on ${facts.daysWithEatingOut} of ${facts.daysTracked} tracked days.`}
        </p>
      )}

      {showRate && (
        <p className="text-xs text-muted">
          The trend is a line fitted through every weigh-in, not the difference
          between two — daily weight swings a pound on water alone.
        </p>
      )}
    </section>
  );
}
