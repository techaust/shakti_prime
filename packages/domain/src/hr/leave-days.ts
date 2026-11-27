// The days a leave request counts (docs/03-roadmap-appendix/phase5.md §5): the working days of its
// span, first and last day included, by the person's shift (its weekly days off) and the holidays
// of their company and of the group. A pure function, so the count is the same wherever it is made.

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a `YYYY-MM-DD` calendar date, or NaN when it is not a real date. */
function dayNumber(date: string): number {
  const m = DATE.exec(date);
  if (!m) return Number.NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
    ? t / DAY_MS
    : Number.NaN;
}

/** Whether `date` is a real calendar date in `YYYY-MM-DD` form. */
export function isCalendarDate(date: string): boolean {
  return !Number.isNaN(dayNumber(date));
}

/** The ISO day of the week of a calendar date: 1 Monday to 7 Sunday. */
export function isoWeekday(date: string): number {
  // 1970-01-01 was a Thursday (ISO 4).
  return ((((dayNumber(date) + 3) % 7) + 7) % 7) + 1;
}

/** Days from the first to the last, both included; 0 when the last is before the first. */
export function spanDays(fromDate: string, toDate: string): number {
  const span = dayNumber(toDate) - dayNumber(fromDate) + 1;
  return Number.isNaN(span) || span < 0 ? 0 : span;
}

/** Every calendar date from the first to the last, both included. */
export function datesBetween(fromDate: string, toDate: string): string[] {
  const first = dayNumber(fromDate);
  const out: string[] = [];
  for (let i = 0; i < spanDays(fromDate, toDate); i += 1) {
    out.push(new Date((first + i) * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

export interface LeaveSpan {
  fromDate: string;
  toDate: string;
  /** The ISO days of the week off in the person's shift; none when they have no shift. */
  weeklyOffDays: readonly number[];
  /** The holidays in the span, as calendar dates. */
  holidays: ReadonlySet<string>;
}

/** The working days of a span: every day that is neither a weekly day off nor a holiday. */
export function countLeaveDays(span: LeaveSpan): number {
  const off = new Set(span.weeklyOffDays);
  return datesBetween(span.fromDate, span.toDate).filter(
    (d) => !off.has(isoWeekday(d)) && !span.holidays.has(d),
  ).length;
}
