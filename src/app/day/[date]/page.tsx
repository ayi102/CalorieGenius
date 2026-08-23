import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getDay, getProfile, targetsForProfile } from "@/lib/queries";
import { addDays, todayIso } from "@/lib/time";
import { EntryCard } from "@/app/entry-card";
import { ScoreCard } from "@/app/score-card";

export const dynamic = "force-dynamic";

export default async function DayPage({ params }: PageProps<"/day/[date]">) {
  const user = await requireUser();
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const profile = await getProfile(user.userId);
  if (!profile) return <p className="text-negative">Profile not found.</p>;

  const targets = targetsForProfile(profile);
  const day = await getDay(
    user.userId,
    date,
    profile.timezone,
    targets,
    profile.bedtimeMinutes,
    profile.goal,
    profile.eatingWindowEnabled
      ? { start: profile.eatingWindowStart, end: profile.eatingWindowEnd }
      : null,
  );

  const today = todayIso(profile.timezone);
  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="display text-2xl">{label}</h1>
          {date === today && <p className="text-sm text-muted">Today</p>}
        </div>
        <nav className="flex gap-1 text-sm">
          <Link
            href={`/day/${addDays(date, -1)}`}
            className="rounded-md border border-border px-3 py-1.5 text-muted hover:text-foreground"
          >
            ←
          </Link>
          {addDays(date, 1) <= today && (
            <Link
              href={`/day/${addDays(date, 1)}`}
              className="rounded-md border border-border px-3 py-1.5 text-muted hover:text-foreground"
            >
              →
            </Link>
          )}
          <Link
            href="/month"
            className="rounded-md border border-border px-3 py-1.5 text-muted hover:text-foreground"
          >
            Month
          </Link>
        </nav>
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          {day.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
              Nothing logged on this day.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {day.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>
        <aside>
          <ScoreCard score={day.score} />
        </aside>
      </div>
    </div>
  );
}
