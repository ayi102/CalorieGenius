import type { UsageSummary } from "@/lib/queries";

/** Cents, shown as cents below a dollar — "$0.04" reads as nothing. */
function money(cents: number): string {
  if (cents < 1) return `${cents.toFixed(2)}¢`;
  if (cents < 100) return `${cents.toFixed(1)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * What the food lookups have cost.
 *
 * Worth showing rather than hiding: the app spends real money per new food, and
 * someone should be able to see how much rather than trust a claim about it.
 * These are recorded figures from the usage meter, not a projection.
 */
export function UsageCard({
  usage,
  dailyLimit,
}: {
  usage: UsageSummary;
  dailyLimit: number;
}) {
  const since = usage.firstUsedAt
    ? new Date(usage.firstUsedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Lookups &amp; cost</h2>
        <p className="mt-0.5 text-xs text-muted">
          A new food costs one lookup. Repeats and re-logged meals are free, so
          this stays well below the number of meals you&apos;ve logged.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="card p-2.5 sm:p-3">
          <dt className="text-[11px] leading-tight text-muted sm:text-xs">Total lookups</dt>
          <dd className="display mt-1 text-lg tnum sm:text-xl">{usage.totalParses}</dd>
        </div>
        <div className="card p-2.5 sm:p-3">
          <dt className="text-[11px] leading-tight text-muted sm:text-xs">Total cost</dt>
          <dd className="display mt-1 text-lg tnum sm:text-xl">
            {money(usage.totalCostCents)}
          </dd>
        </div>
        <div className="card p-2.5 sm:p-3">
          <dt className="text-[11px] leading-tight text-muted sm:text-xs">Last 30 days</dt>
          <dd className="display mt-1 text-lg tnum sm:text-xl">{usage.recentParses}</dd>
          <dd className="mt-0.5 text-xs text-muted tnum">
            {money(usage.recentCostCents)}
          </dd>
        </div>
        <div className="card p-2.5 sm:p-3">
          <dt className="text-[11px] leading-tight text-muted sm:text-xs">Per lookup</dt>
          <dd className="display mt-1 text-lg tnum sm:text-xl">
            {usage.averageCostCents === null
              ? "—"
              : money(usage.averageCostCents)}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-muted">
        {usage.totalParses === 0
          ? `Nothing looked up yet. The cap is ${dailyLimit} per day.`
          : `Across ${usage.daysWithParses} ${usage.daysWithParses === 1 ? "day" : "days"}${since ? ` since ${since}` : ""}. Capped at ${dailyLimit} per day — past that you can still log by typing the numbers yourself.`}
      </p>
    </section>
  );
}
