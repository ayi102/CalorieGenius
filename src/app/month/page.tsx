import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMonth, getProfile, targetsForProfile } from "@/lib/queries";
import { addDays, monthBounds, todayIso, utcToIsoDate } from "@/lib/time";
import { MonthHeatmap } from "./month-heatmap";
import { FoodGroupChart } from "./food-groups";

export const dynamic = "force-dynamic";

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function MonthPage({
  searchParams,
}: PageProps<"/month">) {
  const user = await requireUser();
  const profile = await getProfile(user.userId);
  if (!profile) return <p className="text-negative">Profile not found.</p>;

  const params = await searchParams;
  const today = todayIso(profile.timezone);
  const anchorParam = typeof params.m === "string" ? params.m : null;
  // Fall back to this month rather than erroring on a hand-edited URL.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorParam ?? "")
    ? anchorParam!
    : today;

  const targets = targetsForProfile(profile);
  const month = await getMonth(
    user.userId,
    anchor,
    profile.timezone,
    targets,
    profile.bedtimeMinutes,
    profile.goal,
    profile.eatingWindowEnabled
      ? { start: profile.eatingWindowStart, end: profile.eatingWindowEnd }
      : null,
    today,
  );

  const { start, end } = monthBounds(anchor);
  const prev = addDays(utcToIsoDate(start), -1);
  const next = addDays(utcToIsoDate(end), 1);
  const monthLabel = new Date(`${anchor}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const s = month.summary;
  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{monthLabel}</h1>
          <p className="text-sm text-muted">
            {s.trackedDays} of {s.totalDaysElapsed} days tracked
          </p>
        </div>
        <nav className="flex gap-1 text-sm">
          <Link
            href={`/month?m=${prev}`}
            className="rounded-md border border-border px-3 py-1.5 text-muted hover:text-foreground"
          >
            ← Previous
          </Link>
          {/* Hidden when already on the current month: a link into the future
              would only ever show empty cells. */}
          {next <= today && (
            <Link
              href={`/month?m=${next}`}
              className="rounded-md border border-border px-3 py-1.5 text-muted hover:text-foreground"
            >
              Next →
            </Link>
          )}
        </nav>
      </div>

      {/* KPI row: headline numbers are stat tiles, not one-bar charts. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Average score"
          value={s.averageScore === null ? "—" : String(s.averageScore)}
          sub={s.trackedDays === 0 ? "nothing logged" : "on tracked days"}
        />
        <Tile
          label="Average calories"
          value={s.averageKcal === null ? "—" : s.averageKcal.toLocaleString()}
          sub={`target ${targets.kcal.toLocaleString()}`}
        />
        <Tile
          label="Meals per day"
          value={s.averageMeals === null ? "—" : String(s.averageMeals)}
        />
        <Tile
          label="Days on target"
          value={String(s.daysOnTarget)}
          sub="within 10% of target"
        />
      </section>

      <MonthHeatmap days={month.days} />

      <div className="grid gap-6 md:grid-cols-2">
        <FoodGroupChart groups={month.foodGroups} />

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Best and worst</h2>
          {s.bestDay === null ? (
            <p className="mt-2 text-sm text-muted">
              Log a few days and they&apos;ll show up here.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <li className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/day/${s.bestDay.date}`}
                  className="text-accent underline"
                >
                  {fmtDay(s.bestDay.date)}
                </Link>
                <span className="tnum text-muted">
                  best · {s.bestDay.score}
                </span>
              </li>
              {s.worstDay && (
                <li className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/day/${s.worstDay.date}`}
                    className="text-accent underline"
                  >
                    {fmtDay(s.worstDay.date)}
                  </Link>
                  <span className="tnum text-muted">
                    lowest · {s.worstDay.score}
                  </span>
                </li>
              )}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted">
            Untracked days are shown blank and left out of every average — a day
            you didn&apos;t log isn&apos;t a bad day.
          </p>
        </div>
      </div>
    </div>
  );
}
