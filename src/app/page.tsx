import { requireUser } from "@/lib/auth";
import {
  getDay,
  getParseUsage,
  getProfile,
  getRememberedFoods,
  getRememberedMeals,
  targetsForProfile,
} from "@/lib/queries";
import { env } from "@/lib/env";
import { todayIso } from "@/lib/time";
import { EntryBox } from "./entry-box";
import { Remembered } from "./remembered";
import { ScoreCard } from "./score-card";
import { EntryCard } from "./entry-card";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  of,
  unit,
}: {
  label: string;
  value: number;
  of?: number;
  unit?: string;
}) {
  const pct = of && of > 0 ? Math.min(100, (value / of) * 100) : null;
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum mt-1 text-xl font-semibold">
        {Math.round(value)}
        {of !== undefined && (
          <span className="text-sm font-normal text-muted">
            {" "}
            / {of}
            {unit && ` ${unit}`}
          </span>
        )}
      </div>
      {pct !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default async function TodayPage() {
  const user = await requireUser();
  const profile = await getProfile(user.userId);
  if (!profile) return <p className="text-negative">Profile not found.</p>;

  const targets = targetsForProfile(profile);
  const today = todayIso(profile.timezone);

  const [day, usage, rememberedMeals, rememberedFoods] = await Promise.all([
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
    getRememberedMeals(user.userId),
    getRememberedFoods(user.userId),
  ]);

  const totals = day.score?.totals ?? {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    mealCount: 0,
  };
  const remaining = Math.max(0, env.dailyParseLimit() - usage.used);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-sm text-muted">
          {new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
        </p>
      </div>

      <EntryBox
        parsesRemaining={remaining}
        knownMeals={rememberedMeals.map((m) => ({
          entryId: m.entryId,
          rawText: m.rawText,
          kcal: m.kcal,
          timesLogged: m.timesLogged,
        }))}
      />

      <Remembered meals={rememberedMeals} foods={rememberedFoods} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Calories" value={totals.kcal} of={targets.kcal} unit="kcal" />
        <Stat label="Protein" value={totals.protein} of={targets.protein} unit="g" />
        <Stat label="Carbs" value={totals.carbs} />
        <Stat label="Fat" value={totals.fat} />
      </section>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            {day.entries.length === 0
              ? "No meals yet"
              : `${day.entries.length} ${day.entries.length === 1 ? "meal" : "meals"}`}
          </h2>

          {day.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
              Type what you ate above. Plain language is fine.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {day.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-3">
          <ScoreCard score={day.score} />
          <p className="text-xs text-muted">
            {usage.used} parse{usage.used === 1 ? "" : "s"} today · about{" "}
            {usage.costCents < 1
              ? `${usage.costCents.toFixed(2)}¢`
              : `$${(usage.costCents / 100).toFixed(3)}`}
          </p>
        </aside>
      </div>
    </div>
  );
}
