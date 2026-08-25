import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  countTrackedDays,
  getInsight,
  getKnownFacts,
  getProfile,
  targetsForProfile,
} from "@/lib/queries";
import { addDays, todayIso } from "@/lib/time";
import { InsightReportSchema } from "@/lib/insights/types";
import { PatternReportSchema, PATTERN_MIN_DAYS } from "@/lib/insights/patterns";
import { InsightView } from "./insight-view";
import { PatternsView } from "./patterns-view";
import { FactsCard } from "./facts-card";
import { Tabs } from "../tabs";

export const dynamic = "force-dynamic";

/** Monday of the week containing `iso`. Weeks run Monday–Sunday. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -shift);
}

/** The pattern window: eight weeks back, which is enough for weekday effects. */
const PATTERN_WINDOW_DAYS = 56;

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

  const wkStart = weekStart(anchor);
  const wkEnd = addDays(wkStart, 6);
  const patStart = addDays(today, -(PATTERN_WINDOW_DAYS - 1));
  const targets = targetsForProfile(profile);

  const [facts, weekly, patterns, weekDays, patternDays] = await Promise.all([
    getKnownFacts(user.userId, today, targets.kcal, profile.goal),
    getInsight(user.userId, wkStart, "weekly"),
    getInsight(user.userId, patStart, "patterns"),
    countTrackedDays(user.userId, wkStart, wkEnd),
    countTrackedDays(user.userId, patStart, today),
  ]);

  // Re-validate stored JSON rather than trusting it: schemas move.
  const weeklyParsed = weekly ? InsightReportSchema.safeParse(weekly.report) : null;
  const patternsParsed = patterns
    ? PatternReportSchema.safeParse(patterns.report)
    : null;

  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="display text-2xl">Insights</h1>
        <p className="text-sm text-muted">
          What your log shows, and what it adds up to.
        </p>
      </header>

      {/* Facts first and always: they need no model call and no minimum. */}
      <FactsCard facts={facts} units={profile.unitSystem} goal={profile.goal} />

      <Tabs
        initial="patterns"
        tabs={[
          {
            id: "patterns",
            label: "Deeper patterns",
            content: (
              <PatternsView
                report={patternsParsed?.success ? patternsParsed.data : null}
                generatedAt={patterns?.generatedAt ?? null}
                periodStart={patStart}
                periodEnd={today}
                daysTracked={patternDays}
                minDays={PATTERN_MIN_DAYS}
              />
            ),
          },
          {
            id: "week",
            label: "This week",
            content: (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="flex-1 text-sm text-muted">
                    {fmt(wkStart)} – {fmt(wkEnd)}
                  </p>
                  <nav className="flex gap-1.5">
                    <Link
                      href={`/insights?w=${addDays(wkStart, -7)}`}
                      aria-label="Previous week"
                      className="grid min-h-9 w-9 place-items-center rounded-full border border-border text-muted hover:text-foreground"
                    >
                      ←
                    </Link>
                    {addDays(wkStart, 7) <= today && (
                      <Link
                        href={`/insights?w=${addDays(wkStart, 7)}`}
                        aria-label="Next week"
                        className="grid min-h-9 w-9 place-items-center rounded-full border border-border text-muted hover:text-foreground"
                      >
                        →
                      </Link>
                    )}
                  </nav>
                </div>
                <InsightView
                  report={weeklyParsed?.success ? weeklyParsed.data : null}
                  generatedAt={weekly?.generatedAt ?? null}
                  periodStart={wkStart}
                  periodEnd={wkEnd}
                  periodLabel={`${fmt(wkStart)} – ${fmt(wkEnd)}`}
                  trackedDays={weekDays}
                  canGenerate={weekDays >= 3}
                />
              </div>
            ),
          },
        ]}
      />

      <p className="text-xs text-muted">
        Written from what you logged. It only knows what you recorded, and it
        isn&apos;t medical advice.
      </p>
    </div>
  );
}
