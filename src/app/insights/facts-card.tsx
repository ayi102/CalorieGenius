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

  const up = facts.ultraProcessedPct;

  /**
   * Nine tiles in a 3x3 grid, grouped: intake and outcome, then habits, then
   * nutrients. Ultra-processed share earns a tile rather than a footnote — for a
   * weight-loss goal it is one of the more actionable figures on the page, and
   * burying it under the grid said the opposite.
   */
  const tiles: {
    label: string;
    value: string;
    sub?: string;
    tone?: "good" | "watch" | null;
  }[] = [
    {
      label: "Calories a day",
      value: facts.avgKcal === null ? "—" : facts.avgKcal.toLocaleString(),
      sub: `target ${facts.targetKcal.toLocaleString()}`,
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
      tone: rateGood === null ? null : rateGood ? "good" : null,
    },
    {
      label: "Days on target",
      value: `${facts.daysOnTarget}`,
      sub: `of ${facts.daysTracked} tracked`,
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
      label: "Ultra-processed",
      value: up === null ? "—" : `${up}%`,
      sub: "of your calories",
      // Above a third of intake is the point worth noticing; below a fifth is
      // genuinely good. In between says nothing, so it stays neutral.
      tone: up === null ? null : up >= 35 ? "watch" : up <= 20 ? "good" : null,
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
      // 25 g is the common daily reference for women; under 15 is low enough to
      // be worth flagging.
      tone:
        facts.avgFiber === null
          ? null
          : facts.avgFiber >= 25
            ? "good"
            : facts.avgFiber < 15
              ? "watch"
              : null,
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
          {facts.daysTracked === 0 ? (
            facts.todayExcluded ? (
              <>
                Today is still going, so there&apos;s nothing complete to average
                yet. These fill in tomorrow.
              </>
            ) : (
              <>Nothing logged in the last {facts.windowDays} days.</>
            )
          ) : (
            <>
              Straight from your log · {facts.daysTracked} complete{" "}
              {facts.daysTracked === 1 ? "day" : "days"}
              {facts.through && (
                <>
                  {" "}
                  through{" "}
                  {new Date(`${facts.through}T00:00:00Z`).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", timeZone: "UTC" },
                  )}
                </>
              )}
            </>
          )}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3">
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd
              className={`display mt-1 text-xl tnum ${
                t.tone === "good"
                  ? "text-positive"
                  : t.tone === "watch"
                    ? "text-warning"
                    : ""
              }`}
            >
              {t.value}
            </dd>
            {t.sub && <dd className="mt-0.5 text-[11px] text-muted">{t.sub}</dd>}
          </div>
        ))}
      </dl>

      {facts.daysWithEatingOut > 0 && (
        <p className="text-xs text-muted">
          You ate out on {facts.daysWithEatingOut} of {facts.daysTracked}{" "}
          complete days.
        </p>
      )}

      {facts.todayExcluded && facts.daysTracked > 0 && (
        <p className="text-xs text-muted">
          Today isn&apos;t counted — it&apos;s only part-way through, and
          including it would drag every average down. See it on the Today screen.
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
