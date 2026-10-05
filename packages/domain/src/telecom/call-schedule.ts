import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { nextCallingWindowStart } from './dial-policy';

/**
 * When the next call to a lead falls due (docs/design/phase1.md §7.2): a retry after an unanswered
 * attempt (CALL-3) and the nurture calls (CALL-5), each at the start of a day's calling hours in
 * IST. Pure functions over the clock; `calls.log` and `crm.opportunity.nurture` call them.
 */

const DAY_MS = 86_400_000;
/** India has one time zone and no daylight saving: a fixed offset is exact. */
const IST_OFFSET_MS = 330 * 60_000;

/** Midnight IST of the day `at` falls on. */
export function istDayStart(at: Date): Date {
  const local = at.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** The start of calling hours on the IST day `days` after the day of `at` (0 is that day). */
export function callingStartOnDay(at: Date, days: number): Date {
  return nextCallingWindowStart(new Date(istDayStart(at).getTime() + days * DAY_MS));
}

/** What follows an unanswered attempt: another attempt due at a time, or nurture. */
export type AfterUnanswered = { kind: 'retry'; dueAt: Date } | { kind: 'nurture' };

/**
 * After unanswered attempt `attemptNo` (1 for the first) of a run that began at `firstAttemptAt`:
 * the next attempt on its day (`attemptDays`, counted from the first attempt's day), at the start
 * of that day's calling hours; or nurture once every attempt is used. A due time already passed
 * (an attempt made late) moves to the start of the next day's calling hours, so a lead is never
 * called twice in a row on one day by the rule.
 */
export function afterUnanswered(
  attemptNo: number,
  firstAttemptAt: Date,
  now: Date,
  attemptDays: readonly number[] = WORKSHOP_DEFAULTS.calling.attemptDays,
): AfterUnanswered {
  const nextDay = attemptDays[attemptNo];
  if (nextDay === undefined) return { kind: 'nurture' };
  const scheduled = callingStartOnDay(firstAttemptAt, nextDay);
  return {
    kind: 'retry',
    dueAt: scheduled.getTime() > now.getTime() ? scheduled : callingStartOnDay(now, 1),
  };
}

/** The nurture calls of a lead that entered nurture at `enteredAt`, earliest first. */
export function nurtureCallTimes(
  enteredAt: Date,
  days: readonly number[] = WORKSHOP_DEFAULTS.calling.nurtureCallDays,
): Date[] {
  return [...days].sort((a, b) => a - b).map((d) => callingStartOnDay(enteredAt, d));
}
