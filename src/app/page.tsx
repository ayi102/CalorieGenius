import { requireUser } from "@/lib/auth";
import {
  getDay,
  getParseUsage,
  getProfile,
  getRememberedFoods,
  getRememberedMeals,
  getWaterForDay,
  getWeightHistory,
  targetsForProfile,
} from "@/lib/queries";
import { env } from "@/lib/env";
import { todayIso } from "@/lib/time";
import { TodayLog } from "./today-log";
import { ScoreCard } from "./score-card";
import { DaySummary } from "./day-summary";
import { Tabs } from "./tabs";
import { InstallHint } from "./install-hint";
import { Water } from "./water";
import { Weight } from "./weight";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await requireUser();
  const profile = await getProfile(user.userId);
  if (!profile) return <p className="text-negative">Profile not found.</p>;

  const targets = targetsForProfile(profile);
  const today = todayIso(profile.timezone);

  const [day, usage, rememberedMeals, rememberedFoods, water, weight] =
    await Promise.all([
    getDay(
      user.userId,
      today,
      profile.timezone,
      targets,
      profile.bedtimeMinutes,
      profile.goal,
      profile.eatingWindowEnabled
        ? { start: profile.eatingWindowStart, end: profile.eatingWindowEnd }
        : null,
    ),
    getParseUsage(user.userId, today),
    getRememberedMeals(user.userId, targets.kcal),
    getRememberedFoods(user.userId),
    getWaterForDay(
      user.userId,
      today,
      profile.timezone,
      profile.weightKg,
      profile.waterTargetMl,
    ),
    getWeightHistory(user.userId),
  ]);

  const remaining = Math.max(0, env.dailyParseLimit() - usage.used);
  const macros = day.score?.totals;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="display text-2xl">Today</h1>
        <p className="text-sm text-muted">
          {new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
        </p>
      </header>

      {/* Always visible: hiding today's total behind a tab would defeat the app. */}
      <DaySummary
        score={day.score}
        targets={targets}
        waterMl={water.totalMl}
        waterTargetMl={water.targetMl}
        units={profile.unitSystem}
      />

      {/* Hides itself once installed, or once dismissed. */}
      <InstallHint />

      <Tabs
        initial="today"
        tabs={[
          {
            id: "today",
            label: "Log",
            badge: day.entries.length > 0 ? String(day.entries.length) : undefined,
            content: (
              <TodayLog
                entries={day.entries}
                meals={rememberedMeals}
                foods={rememberedFoods}
                parsesRemaining={remaining}
              />
            ),
          },
          {
            id: "body",
            label: "Body",
            badge: `${Math.round((water.totalMl / water.targetMl) * 100)}%`,
            content: (
              <div className="flex flex-col gap-4">
                <Water water={water} units={profile.unitSystem} />
                <Weight
                  history={weight}
                  units={profile.unitSystem}
                  goal={profile.goal}
                />
              </div>
            ),
          },
          {
            id: "score",
            label: "Score",
            badge: day.score ? String(day.score.total) : undefined,
            content: (
              <div className="flex flex-col gap-4">
                <ScoreCard score={day.score} />
                {macros && (
                  <div className="card p-4">
                    <h2 className="text-sm font-semibold">Macros</h2>
                    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { label: "Protein", value: macros.protein },
                        { label: "Carbs", value: macros.carbs },
                        { label: "Fat", value: macros.fat },
                        { label: "Fiber", value: macros.fiber },
                      ].map((m) => (
                        <div key={m.label}>
                          <dt className="text-xs text-muted">{m.label}</dt>
                          <dd className="display mt-0.5 text-xl tnum">
                            {m.value}
                            <span className="ml-0.5 font-sans text-xs text-muted">g</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                <p className="text-xs text-muted tnum">
                  {usage.used} parse{usage.used === 1 ? "" : "s"} today ·{" "}
                  {usage.costCents < 1
                    ? `${usage.costCents.toFixed(2)}¢`
                    : `$${(usage.costCents / 100).toFixed(3)}`}{" "}
                  · {remaining} left
                </p>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
