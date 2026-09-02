"use client";

import { useRouter } from "next/navigation";

/**
 * Jump straight to any month that has data.
 *
 * The arrows still step one month at a time, but stepping back through a year to
 * reach last January is not navigation, it is a chore. A native select is
 * deliberate here: on a phone iOS renders it as a scroll wheel, which is a better
 * month picker than anything worth hand-building.
 */
export function MonthPicker({
  months,
  current,
}: {
  months: { month: string; label: string; days: number }[];
  current: string;
}) {
  const router = useRouter();
  if (months.length === 0) return null;

  // The month being viewed may have no entries, so make sure it is selectable
  // rather than the control showing someone else's month.
  const options = months.some((m) => m.month === current)
    ? months
    : [
        {
          month: current,
          label: new Date(`${current}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }),
          days: 0,
        },
        ...months,
      ];

  return (
    <select
      value={current}
      onChange={(e) => router.push(`/month?m=${e.target.value}`)}
      aria-label="Jump to a month"
      className="min-h-10 max-w-full rounded-md border border-border bg-surface px-2.5 text-sm"
    >
      {options.map((m) => (
        <option key={m.month} value={m.month}>
          {m.label}
          {m.days > 0 && ` · ${m.days} ${m.days === 1 ? "day" : "days"}`}
        </option>
      ))}
    </select>
  );
}
