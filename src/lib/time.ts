/**
 * Local-calendar helpers.
 *
 * The rule for this app: an `Entry.eatenAt` is a true instant (`timestamptz`),
 * but every *bucket* the user sees — "today", a month cell, meal spacing,
 * late-night eating — is a wall-clock concept in the user's own timezone.
 *
 * So all conversion happens here, against an explicit IANA zone, and never
 * against the server's clock. A 9pm meal in New York belongs to that day, not
 * to tomorrow because the server happens to be on UTC.
 *
 * Pure: no DB, no framework, no implicit "now". Callers pass the instant in.
 */

/** `YYYY-MM-DD` — how a local calendar date is addressed in URLs and keys. */
export type IsoDate = string;

/**
 * Split an instant into its wall-clock parts in `timeZone`.
 *
 * Uses `Intl` rather than manual offset math so DST transitions and historical
 * offset changes are handled by the platform's tz database.
 */
function localParts(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const out: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(instant)) {
    if (type !== "literal") out[type] = Number(value);
  }
  // `hour12: false` can render midnight as 24 in some engines; normalize it.
  if (out.hour === 24) out.hour = 0;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
  };
}

/**
 * The local calendar date of `instant`, as `YYYY-MM-DD`.
 *
 * This is the value stored in `Entry.localDate` and the key every day/month
 * query ranges over.
 */
export function toIsoDate(instant: Date, timeZone: string): IsoDate {
  const { year, month, day } = localParts(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The local calendar date as a `Date` pinned to UTC midnight — the shape
 * Postgres `date` columns round-trip through Prisma without shifting.
 *
 * Always pair a `@db.Date` column with this, never with a raw `new Date()`.
 */
export function toLocalDate(instant: Date, timeZone: string): Date {
  const { year, month, day } = localParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Minutes past local midnight (0..1439). Feeds the timing score. */
export function toLocalMinutes(instant: Date, timeZone: string): number {
  const { hour, minute } = localParts(instant, timeZone);
  return hour * 60 + minute;
}

/** Parse `YYYY-MM-DD` into a UTC-midnight `Date`, for `@db.Date` comparisons. */
export function isoDateToUtc(iso: IsoDate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date "${iso}" — expected YYYY-MM-DD.`);
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Reject impossible dates that Date.UTC would silently roll over (e.g. 02-31).
  if (toIsoDate(date, "UTC") !== iso) {
    throw new Error(`Invalid calendar date "${iso}".`);
  }
  return date;
}

/** Render a `@db.Date` value back to `YYYY-MM-DD` (it is already UTC midnight). */
export function utcToIsoDate(date: Date): IsoDate {
  return toIsoDate(date, "UTC");
}

/** Today's local date in `timeZone`. The only place "now" enters. */
export function todayIso(timeZone: string, now: Date = new Date()): IsoDate {
  return toIsoDate(now, timeZone);
}

/** Inclusive first and last local dates of the month containing `iso`. */
export function monthBounds(iso: IsoDate): { start: Date; end: Date } {
  const d = isoDateToUtc(iso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)),
    // Day 0 of the next month is the last day of this one.
    end: new Date(Date.UTC(year, month + 1, 0)),
  };
}

/** Every local date in the month containing `iso`, in order. */
export function monthDays(iso: IsoDate): IsoDate[] {
  const { start, end } = monthBounds(iso);
  const days: IsoDate[] = [];
  for (let d = start.getUTCDate(); d <= end.getUTCDate(); d++) {
    days.push(
      utcToIsoDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d))),
    );
  }
  return days;
}

/** Shift a local date by whole days. Used by day-to-day navigation. */
export function addDays(iso: IsoDate, delta: number): IsoDate {
  const d = isoDateToUtc(iso);
  d.setUTCDate(d.getUTCDate() + delta);
  return utcToIsoDate(d);
}

/**
 * Which meal an instant most likely belongs to, from local wall-clock time.
 * Only ever a default — the user can always change it.
 */
export function guessMealType(
  instant: Date,
  timeZone: string,
): "breakfast" | "lunch" | "dinner" | "snack" {
  const m = toLocalMinutes(instant, timeZone);
  if (m >= 300 && m < 660) return "breakfast"; // 05:00–11:00
  if (m >= 660 && m < 930) return "lunch"; //     11:00–15:30
  if (m >= 990 && m < 1320) return "dinner"; //   16:30–22:00
  return "snack";
}

/** Format minutes-past-midnight as `h:mm AM/PM`. */
export function formatLocalMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const mm = String(minutes % 60).padStart(2, "0");
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${period}`;
}

/**
 * Signed circular distance in minutes from `minutes` to `reference`, on a
 * 24-hour clock, in the range (-720, 720].
 *
 * Positive means `minutes` is *before* `reference`. Needed because "3 hours
 * before an 11pm bedtime" and "1am, which is after it" both have to work
 * without special-casing midnight.
 */
export function minutesUntil(minutes: number, reference: number): number {
  let diff = (reference - minutes) % 1440;
  if (diff > 720) diff -= 1440;
  if (diff <= -720) diff += 1440;
  return diff;
}

/**
 * Is a local wall-clock minute inside the window `[start, end)`?
 *
 * Handles windows that wrap midnight, which are legitimate schedules: a
 * 20:00–04:00 window has `end <= start`, and a naive `m >= start && m < end`
 * would call every such window empty.
 *
 * A zero-length window (start === end) is treated as "always allowed" rather
 * than "never allowed" — the latter would silently zero someone's score if they
 * mis-set the field, which is a worse failure than being too permissive.
 */
export function isWithinWindow(
  minutes: number,
  start: number,
  end: number,
): boolean {
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  // Wraps midnight: inside means after the start OR before the end.
  return minutes >= start || minutes < end;
}

/**
 * How far outside the window a time is, in minutes (0 when inside).
 *
 * Used to scale the penalty: a meal five minutes late is not the same failure as
 * one five hours early.
 */
export function minutesOutsideWindow(
  minutes: number,
  start: number,
  end: number,
): number {
  if (isWithinWindow(minutes, start, end)) return 0;
  // Distance to whichever boundary is nearer, on a circular clock.
  const toStart = Math.abs(minutesUntil(minutes, start));
  const toEnd = Math.abs(minutesUntil(minutes, end));
  return Math.min(toStart, toEnd);
}

/** Duration of a window in minutes, accounting for a midnight wrap. */
export function windowLength(start: number, end: number): number {
  if (start === end) return 1440;
  return start < end ? end - start : 1440 - start + end;
}
