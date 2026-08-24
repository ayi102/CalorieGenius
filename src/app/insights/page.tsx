import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { countTrackedDays, getInsight, getProfile } from "@/lib/queries";
import { addDays, todayIso } from "@/lib/time";
import { InsightReportSchema } from "@/lib/insights/types";
import { InsightView } from "./insight-view";

export const dynamic = "force-dynamic";

/** Monday of the week containing `iso`. Weeks run Monday–Sunday. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const shift = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -shift);
}

export default async function InsightsPage({
  searchParams,
}: PageProps<"/insights">) {
  const user = await requireUser();
  const profile = await getProfile(user.userId);
  if (!profile) return <p className="text-negative">Profile not found.</p>;

  const params = await searchParams;
  const today = todayIso(profile.timezone);
  const anchor =
    typeof params.w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.w)
      ? params.w
      : today;

  const start = weekStart(anchor);
  const end = addDays(start, 6);
  const prevWeek = addDays(start, -7);
  const nextWeek = addDays(start, 7);

  const [cached, trackedDays] = await Promise.all([
    getInsight(user.userId, start),
    countTrackedDays(user.userId, start, end),
  ]);

  // Re-validate stored JSON rather than trusting it: the schema may have moved.
  const parsed = cached ? InsightReportSchema.safeParse(cached.report) : null;
  const report = parsed?.success ? parsed.data : null;

  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const periodLabel = `${fmt(start)} – ${fmt(end)}`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="display text-2xl">Your week</h1>
          <p className="text-sm text-muted">{periodLabel}</p>
        </div>
        <nav className="flex gap-1.5">
          <Link
            href={`/insights?w=${prevWeek}`}
            aria-label="Previous week"
            className="grid min-h-10 w-10 place-items-center rounded-full border border-border text-muted hover:text-foreground"
          >
            ←
          </Link>
          {/* No link into a week that hasn't happened. */}
          {nextWeek <= today && (
            <Link
              href={`/insights?w=${nextWeek}`}
              aria-label="Next week"
              className="grid min-h-10 w-10 place-items-center rounded-full border border-border text-muted hover:text-foreground"
            >
              →
            </Link>
          )}
        </nav>
      </header>

      <InsightView
        report={report}
        generatedAt={cached?.generatedAt ?? null}
        periodStart={start}
        periodEnd={end}
        periodLabel={periodLabel}
        trackedDays={trackedDays}
        canGenerate={trackedDays >= 3}
      />
    </div>
  );
}
