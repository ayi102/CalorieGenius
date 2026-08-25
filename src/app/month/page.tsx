import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMonth, getProfile, targetsForProfile } from "@/lib/queries";
import { addDays, monthBounds, todayIso, utcToIsoDate } from "@/lib/time";
import { MonthHeatmap } from "./month-heatmap";
import { FoodGroupChart } from "./food-groups";
import { Tabs } from "../tabs";

export const dynamic = "force-dynamic";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="display mt-1 text-2xl tnum">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function MonthPage({ searchParams }: PageProps<"/month">) {
  const user = await requireUser();
  const profile = await getProfile(user.userId);
  if (!profile) return <p className="text-negative">Profile not found.</p>;

  const params = await searchParams;
  const today = todayIso(profile.timezone);
  const anchorParam = typeof params.m === "string" ? params.m : null;
  // Fall back to this month rather than erroring on a hand-edited URL.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorParam ?? "") ? anchorParam! : today;

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
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="display text-2xl">{monthLabel}</h1>
          <p className="text-sm text-muted">
            {s.trackedDays} of {s.totalDaysElapsed} complete days tracked
            {s.todayExcluded && " · today not counted yet"}
          </p>
        </div>
        <nav className="flex gap-1.5 text-sm">
          <Link
            href={`/month?m=${prev}`}
            aria-label="Previous month"
            className="grid min-h-10 w-10 place-items-center rounded-full border border-border text-muted hover:text-foreground"
          >
            ←
          </Link>
          {/* Hidden on the current month: a link into the future shows only
              empty cells. */}
          {next <= today && (
            <Link
              href={`/month?m=${next}`}
              aria-label="Next month"
              className="grid min-h-10 w-10 place-items-center rounded-full border border-border text-muted hover:text-foreground"
            >
              →
            </Link>
          )}
        </nav>
      </header>

      {/* Headline numbers are stat tiles, not one-bar charts. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Average score"
          value={s.averageScore === null ? "—" : String(s.averageScore)}
          sub={s.trackedDays === 0 ? "nothing logged" : "tracked days"}
        />
        <Tile
          label="Avg calories"
          value={s.averageKcal === null ? "—" : s.averageKcal.toLocaleString()}
          sub={`target ${targets.kcal.toLocaleString()}`}
        />
        <Tile
          label="Meals / day"
          value={s.averageMeals === null ? "—" : String(s.averageMeals)}
        />
        <Tile
          label="On target"
          value={String(s.daysOnTarget)}
          sub="within 10%"
        />
      </section>

      <Tabs
        tabs={[
          {
            id: "calendar",
            label: "Calendar",
            content: <MonthHeatmap days={month.days} />,
          },
          {
            id: "food",
            label: "What you ate",
            content: <FoodGroupChart groups={month.foodGroups} />,
          },
          {
            id: "days",
            label: "Best & worst",
            content: (
              <div className="card p-4">
                <h2 className="text-sm font-semibold">Best and worst days</h2>
                {s.bestDay === null ? (
                  <p className="mt-2 text-sm text-muted">
                    Log a few days and they&apos;ll show up here.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2 text-sm">
                    <li className="flex items-baseline justify-between gap-2">
                      <Link
                        href={`/day/${s.bestDay.date}`}
                        className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                      >
                        {fmtDay(s.bestDay.date)}
                      </Link>
                      <span className="tnum text-muted">best · {s.bestDay.score}</span>
                    </li>
                    {s.worstDay && (
                      <li className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/day/${s.worstDay.date}`}
                          className="underline decoration-border underline-offset-4 hover:decoration-foreground"
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
                  Untracked days are shown blank and left out of every average — a
                  day you didn&apos;t log isn&apos;t a bad day.
                </p>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
