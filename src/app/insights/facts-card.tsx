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
   * Nine tiles, three across at every width.
   *
   * Labels and sub-lines are kept SHORT on purpose: three columns on a 375px
   * phone leaves about 90px of content per tile, and the earlier wording
   * ("Ultra-processed", "from 7 weigh-ins") ran to the edge or past it. Each
   * label is one word where possible, with the unit demoted to the line beneath.
   */
  const weightValue = showRate
    ? units === "imperial"
      ? `${kgToLb(rate!) > 0 ? "+" : "−"}${Math.abs(kgToLb(rate!)).toFixed(1)}`
      : `${rate! > 0 ? "+" : "−"}${Math.abs(rate!).toFixed(2)}`
    : w.latestKg === null
      ? "—"
      : units === "imperial"
        ? String(Math.round(kgToLb(w.latestKg)))
        : w.latestKg.toFixed(1);

  const weightUnit = units === "imperial" ? "lb" : "kg";

  const tiles: {
    label: string;
    value: string;
    sub?: string;
    tone?: "good" | "watch" | null;
  }[] = [
    {
      label: "Calories",
      value: facts.avgKcal === null ? "—" : facts.avgKcal.toLocaleString(),
      sub: `of ${facts.targetKcal.toLocaleString()}`,
    },
    {
      label: "Weight",
      value: weightValue,
      sub: showRate ? `${weightUnit} / week` : w.weighIns < 3 ? "3+ weigh-ins" : weightUnit,
      tone: rateGood === null ? null : rateGood ? "good" : null,
    },
    {
      label: "On target",
      value: `${facts.daysOnTarget}`,
      sub: `of ${facts.daysTracked} days`,
    },
    {
      label: "Eating out",
      value: facts.eatingOutPct === null ? "—" : `${facts.eatingOutPct}%`,
      sub: facts.totalMeals > 0 ? `${facts.mealsOut} of ${facts.totalMeals}` : undefined,
    },
    {
      label: "Processed",
      value: up === null ? "—" : `${up}%`,
      sub: "of calories",
      // Above a third of intake is worth noticing; below a fifth is genuinely
      // good. In between says nothing, so it stays neutral.
      tone: up === null ? null : up >= 35 ? "watch" : up <= 20 ? "good" : null,
    },
    {
      label: "Meals",
      value: facts.avgMealsPerDay === null ? "—" : String(facts.avgMealsPerDay),
      sub: "per day",
    },
    {
      label: "Protein",
      value: facts.avgProtein === null ? "—" : String(facts.avgProtein),
      sub: "g per day",
    },
    {
      label: "Fiber",
      value: facts.avgFiber === null ? "—" : String(facts.avgFiber),
      sub: "g per day",
      // 25 g is the common daily reference; under 15 is low enough to flag.
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
      label: "Water",
      value:
        facts.avgWaterMl === null
          ? "—"
          : formatVolume(facts.avgWaterMl, units).replace(/ (oz|L|ml)$/, ""),
      sub:
        facts.avgWaterMl === null
          ? "per day"
          : `${units === "imperial" ? "oz" : facts.avgWaterMl >= 1000 ? "L" : "ml"} per day`,
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

      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            // Centered: a ragged left edge across nine narrow tiles reads as
            // broken rather than deliberate. min-w-0 lets a long value shrink
            // instead of pushing out of the card.
            className="card flex min-w-0 flex-col items-center justify-center px-1.5 py-3 text-center sm:px-3"
          >
            <dt className="w-full truncate text-[11px] leading-none text-muted sm:text-xs">
              {t.label}
            </dt>
            <dd
              className={`display mt-1.5 w-full truncate text-xl leading-none tnum sm:text-2xl ${
                t.tone === "good"
                  ? "text-positive"
                  : t.tone === "watch"
                    ? "text-warning"
                    : ""
              }`}
            >
              {t.value}
            </dd>
            {/* Always rendered, even when empty, so tiles in a row keep the
                same height. */}
            <dd className="mt-1 w-full truncate text-[10px] leading-none text-muted sm:text-[11px]">
              {t.sub ?? "\u00A0"}
            </dd>
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
