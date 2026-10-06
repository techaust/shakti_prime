import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { nextCallingWindowStart } from './dial-policy';

/**
 * When the next call to a lead falls due (docs/03-roadmap-appendix/phase1.md §7.2): a retry after an unanswered
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

/** A lead's latest call, as the attempt count reads it. */
export interface LastCall {
  attemptNo: number;
  /** The `next_action` of the call's outcome; `retry` is an unanswered attempt. */
  nextAction: string;
  startedAt: Date;
}

/**
 * The unanswered attempts of a lead's current run, which `calls.call.log` numbers the next call
 * from and the workspace and the queue show: the latest call's attempt number when it went
 * unanswered (a `retry` outcome) and was made after the lead's state last changed
 * (`opportunities.state_changed_at`); otherwise none. A lead that enters or leaves nurture starts
 * again at its first attempt, so a reopened lead gets its three tries and a nurture call counts
 * from the start of nurture.
 */
export function unansweredAttempts(last: LastCall | undefined, stateChangedAt: Date): number {
  if (last?.nextAction !== 'retry') return 0;
  return last.startedAt.getTime() > stateChangedAt.getTime() ? last.attemptNo : 0;
}
