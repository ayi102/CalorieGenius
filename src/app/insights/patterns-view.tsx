"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generatePatterns } from "@/lib/actions";
import type { PatternReport } from "@/lib/insights/patterns";

const VERDICT: Record<string, { label: string; className: string }> = {
  keep: { label: "Keep", className: "bg-positive/12 text-positive" },
  moderate: { label: "Moderate", className: "bg-warning/15 text-warning" },
  reduce: { label: "Reduce", className: "bg-negative/12 text-negative" },
};

/**
 * The analysis that needs history.
 *
 * Kept apart from the facts above because the two answer different questions.
 * Facts are arithmetic and instant; this is interpretation over weeks, costs a
 * model call, and is honest about needing enough data to say anything.
 */
export function PatternsView({
  report,
  generatedAt,
  periodStart,
  periodEnd,
  daysTracked,
  minDays,
}: {
  report: PatternReport | null;
  generatedAt: Date | null;
  periodStart: string;
  periodEnd: string;
  daysTracked: number;
  minDays: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ready = daysTracked >= minDays;

  function run(force: boolean) {
    setError(null);
    start(async () => {
      const r = await generatePatterns(periodStart, periodEnd, force);
      if (!r.ok) setError(r.error ?? "Could not build the analysis.");
      else router.refresh();
    });
  }

  if (!report) {
    return (
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-lg">Deeper patterns</h2>
          <p className="mt-0.5 text-xs text-muted">
            Habits across weeks — the foods you lean on, which days run high, what
            eating out costs.
          </p>
        </div>
        <div className="card p-6 text-center">
          {ready ? (
            <>
              <p className="text-sm text-muted">
                {daysTracked} days logged. Enough to find real patterns.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(false)}
                className="mt-4 min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50"
              >
                {pending ? "Looking for patterns…" : "Analyse my habits"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Not enough history yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                {daysTracked} of about {minDays} days. A fortnight is roughly
                where weekday patterns and food habits become real rather than
                coincidence.
              </p>
              <div className="mx-auto mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, (daysTracked / minDays) * 100)}%` }}
                />
              </div>
            </>
          )}
          {error && <p className="mt-3 text-sm text-negative">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="display text-lg">Deeper patterns</h2>
        <p className="mt-0.5 text-xs text-muted">
          Across {daysTracked} tracked days
        </p>
      </div>

      <div className="card p-5">
        <p className="text-[15px] leading-relaxed">{report.summary}</p>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold">Foods you eat a lot of</h3>
        <ul className="mt-3 flex flex-col gap-2.5">
          {report.favouriteFoods.map((f, i) => {
            const v = VERDICT[f.verdict] ?? VERDICT.moderate;
            return (
              <li key={i}>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${v.className}`}
                  >
                    {v.label}
                  </span>
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">
                    {f.food}
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-muted">{f.why}</p>
              </li>
            );
          })}
        </ul>
      </div>

      {report.eatMore.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Lean on these more</h3>
          <p className="mt-0.5 text-xs text-muted">
            Things you already eat and like.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {report.eatMore.map((e, i) => (
              <li key={i}>
                <p className="text-sm font-medium">{e.food}</p>
                <p className="mt-0.5 text-sm text-muted">{e.why}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.swaps.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Swaps, with the weekly saving</h3>
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {report.swaps.map((s, i) => (
              <li key={i} className="py-2.5">
                <p className="text-sm">
                  <span className="text-muted line-through decoration-border">
                    {s.from}
                  </span>
                  <span className="mx-1.5 text-muted">→</span>
                  <span className="font-medium">{s.to}</span>
                </p>
                <p className="mt-0.5 text-sm">
                  <span className="font-medium text-positive">
                    {s.savingPerWeek}
                  </span>
                  <span className="text-muted"> — {s.why}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Your harder days</h3>
          <p className="mt-1.5 text-sm font-medium">{report.worstDays.pattern}</p>
          <p className="mt-0.5 text-sm text-muted">{report.worstDays.detail}</p>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Eating out</h3>
          <p className="mt-1.5 text-sm font-medium">{report.eatingOut.pattern}</p>
          <p className="mt-0.5 text-sm text-muted">{report.eatingOut.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(true)}
          className="min-h-10 rounded-md border border-border px-3 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {pending ? "Rebuilding…" : "Rebuild this analysis"}
        </button>
        {generatedAt && (
          <span className="text-xs text-muted">
            Written{" "}
            {new Date(generatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        {error && <span className="text-sm text-negative">{error}</span>}
      </div>
    </section>
  );
}
