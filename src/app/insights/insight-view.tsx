"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateInsight } from "@/lib/actions";
import type { InsightReport } from "@/lib/insights/types";

const TONE: Record<string, { label: string; className: string }> = {
  win: { label: "Working", className: "bg-positive/12 text-positive" },
  watch: { label: "Watch", className: "bg-warning/15 text-warning" },
  neutral: { label: "Noted", className: "bg-surface-raised text-muted" },
};

export function InsightView({
  report,
  generatedAt,
  periodStart,
  periodEnd,
  periodLabel,
  trackedDays,
  canGenerate,
}: {
  report: InsightReport | null;
  generatedAt: Date | null;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  trackedDays: number;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(force: boolean) {
    setError(null);
    start(async () => {
      const r = await generateInsight(periodStart, periodEnd, force);
      if (!r.ok) setError(r.error ?? "Could not build the review.");
      else router.refresh();
    });
  }

  if (!report) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-medium">No review for {periodLabel} yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          {canGenerate
            ? `${trackedDays} days logged. Building the review reads your week and writes it up — it takes about half a minute.`
            : `Only ${trackedDays} ${trackedDays === 1 ? "day" : "days"} logged this week. Log at least 3 and there'll be something worth reviewing.`}
        </p>
        {canGenerate && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(false)}
            className="mt-4 min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {pending ? "Reading your week…" : "Build my review"}
          </button>
        )}
        {error && <p className="mt-3 text-sm text-negative">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <p className="text-[15px] leading-relaxed">{report.summary}</p>
        <p className="mt-4 rounded-lg bg-accent-soft px-3.5 py-3 text-sm">
          <span className="font-medium">This week: </span>
          {report.focus}
        </p>
      </section>

      {report.observations.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">What stood out</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {report.observations.map((o, i) => {
              const tone = TONE[o.tone] ?? TONE.neutral;
              return (
                <li key={i}>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.className}`}
                    >
                      {tone.label}
                    </span>
                    <p className="text-sm font-medium">{o.headline}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted">{o.detail}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {report.swaps.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Swaps worth trying</h2>
          <p className="mt-0.5 text-xs text-muted">
            From food you actually logged.
          </p>
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
                <p className="mt-0.5 text-sm text-muted">{s.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.tips.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Try this week</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {report.tips.map((t, i) => (
              <li key={i}>
                <p className="text-sm font-medium">{t.tip}</p>
                <p className="mt-0.5 text-sm text-muted">{t.because}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(true)}
          className="min-h-10 rounded-md border border-border px-3 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {pending ? "Rebuilding…" : "Rebuild this review"}
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

      <p className="text-xs text-muted">
        Written from your logged week. It only knows what you recorded, and it
        isn&apos;t medical advice.
      </p>
    </div>
  );
}
