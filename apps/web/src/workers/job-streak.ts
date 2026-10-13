import type { KeyValue } from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';
import { sendCheckIn } from '../observability/check-ins';
import type { ScheduledRoute } from './schedules';

/**
 * The worker routes QStash calls on a timer (`JOB_SCHEDULES`), but the outbox publisher, which
 * keeps a streak of its own (`outbox.publisher_failing`).
 */
export type ScheduledJob = Exclude<ScheduledRoute, 'outbox-publish'>;

/** Failed calls in a row before the owner is told, as for the outbox (`FAILING_RUNS_ALERT`). */
export const FAILING_CALLS_ALERT = 3;

/** A streak older than a week is forgotten: the weekly jobs have none, the others run daily. */
const STREAK_SECONDS = 7 * 24 * 60 * 60;

const streakKey = (job: ScheduledJob) => `job:failing:${job}`;

export interface JobOutcomeOptions {
  requestId: string;
  keyValue?: KeyValue;
  alerts?: AlertSink;
  /** Whether QStash made the call for the job's schedule (`fromSchedule`); only that one checks in. */
  scheduled: boolean;
  /** Where the call is checked in; Sentry's cron monitors by default. */
  checkIn?: (job: ScheduledJob, status: 'ok' | 'error') => Promise<void>;
}

/**
 * Counts a scheduled route's call (audit 2026-10, OPS-3): a call that did its work ends the
 * streak; a failed one (a 500, or a 503 for a lock it could not get) adds to it, and the third in
 * a row raises `job.failing` once, with the job and the count, as the outbox's streak does. A call
 * the schedule made is also checked in to the job's Sentry cron monitor, which raises a run
 * QStash never made; a run handing on the rest is not, so it cannot hide a missed one.
 * The store failing never fails the call: the call's own outcome is already decided.
 */
export async function recordJobOutcome(
  job: ScheduledJob,
  outcome: 'ok' | 'failed',
  options: JobOutcomeOptions,
): Promise<void> {
  const keyValue = options.keyValue ?? defaultAuthDeps().keyValue;
  if (options.scheduled) {
    await (options.checkIn ?? sendCheckIn)(job, outcome === 'ok' ? 'ok' : 'error');
  }
  let runs = 0;
  try {
    if (outcome === 'ok') {
      await keyValue.del(streakKey(job));
      return;
    }
    runs = await keyValue.incr(streakKey(job), STREAK_SECONDS);
  } catch (error) {
    logger.log('warn', 'job.streak_not_kept', { requestId: options.requestId, job, error });
    return;
  }
  if (runs === FAILING_CALLS_ALERT) {
    await (options.alerts ?? sentryAlertSink).report('job.failing', { job, runs });
  }
}
