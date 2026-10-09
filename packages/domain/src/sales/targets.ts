import type { CalendarDate, TargetPeriod } from '@shakti/contracts';

/** India has one time zone and no daylight saving: a fixed offset is exact. */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a UTC date, which here always stands for an IST calendar date. */
function dateText(d: Date): string {
  return `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The UTC midnight a `YYYY-MM-DD` text names (the calendar date on its own, no time zone). */
function parseDate(text: CalendarDate): Date {
  const [y, m, d] = text.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`not a calendar date: ${text}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * The first day, in IST, of the day, week (Monday) or month that holds the instant `at`, as
 * `YYYY-MM-DD`: the `starts_on` of a target for that period.
 */
export function periodStartOn(period: TargetPeriod, at: Date): CalendarDate {
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (period === 'day') return dateText(day);
  if (period === 'month') {
    return dateText(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)));
  }
  // getUTCDay: 0 is Sunday; a week runs Monday to Sunday.
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return dateText(new Date(day.getTime() - sinceMonday * DAY_MS));
}

/** Whether a date is the first day of a period of that length: any day, a Monday, or the 1st. */
export function isPeriodStart(period: TargetPeriod, startsOn: CalendarDate): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return false;
  const d = parseDate(startsOn);
  if (Number.isNaN(d.getTime()) || dateText(d) !== startsOn) return false;
  if (period === 'day') return true;
  if (period === 'week') return d.getUTCDay() === 1;
  return d.getUTCDate() === 1;
}

/** The first day of the next period, which ends the one that starts on `startsOn`. */
function nextStart(period: TargetPeriod, startsOn: CalendarDate): Date {
  const d = parseDate(startsOn);
  if (period === 'day') return new Date(d.getTime() + DAY_MS);
  if (period === 'week') return new Date(d.getTime() + 7 * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** The last day of the period that starts on `startsOn`. */
export function periodEndOn(period: TargetPeriod, startsOn: CalendarDate): CalendarDate {
  return dateText(new Date(nextStart(period, startsOn).getTime() - DAY_MS));
}

/**
 * The instants a period covers, `from` included and `to` not: midnight IST of its first day to
 * midnight IST after its last, which is how a call, a stage move or an order falls in it.
 */
export function periodBounds(
  period: TargetPeriod,
  startsOn: CalendarDate,
): { from: Date; to: Date } {
  return {
    from: new Date(parseDate(startsOn).getTime() - IST_OFFSET_MS),
    to: new Date(nextStart(period, startsOn).getTime() - IST_OFFSET_MS),
  };
}

/**
 * How far an actual figure is to its target: 1 is met, 0.5 half way, above 1 beaten. Null when
 * there is no target (none set, or a value of 0), since nothing is owed then.
 */
export function progressFraction(actual: number, target: number | null): number | null {
  if (target === null || !(target > 0)) return null;
  if (!Number.isFinite(actual) || actual < 0) return 0;
  return actual / target;
}
