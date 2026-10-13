import type { KeyValue } from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';

/**
 * The worker routes QStash calls on a timer, by the id of their schedule without its environment
 * (`apps/web/scripts/qstash-schedule.ts`). The outbox publisher keeps a streak of its own
 * (`outbox.publisher_failing`).
 */
export const SCHEDULED_JOBS = [
  'lead-rescore',
  'duplicate-scan',
  'notification-scan',
  'quote-expire',
  'files-sweep',
  'jobs-check',
] as const;
export type ScheduledJob = (typeof SCHEDULED_JOBS)[number];

/** Failed calls in a row before the owner is told, as for the outbox (`FAILING_RUNS_ALERT`). */
export const FAILING_CALLS_ALERT = 3;

/** A streak older than a week is forgotten: the weekly jobs have none, the others run daily. */
const STREAK_SECONDS = 7 * 24 * 60 * 60;

const streakKey = (job: ScheduledJob) => `job:failing:${job}`;

export interface JobOutcomeOptions {
  requestId: string;
  keyValue?: KeyValue;
  alerts?: AlertSink;
}

/**
 * Counts a scheduled route's call (audit 2026-10, OPS-3): a call that did its work ends the
 * streak; a failed one (a 500, or a 503 for a lock it could not get) adds to it, and the third in
 * a row raises `job.failing` once, with the job and the count, as the outbox's streak does. The
 * store failing never fails the call: the call's own outcome is already decided.
 */
export async function recordJobOutcome(
  job: ScheduledJob,
  outcome: 'ok' | 'failed',
  options: JobOutcomeOptions,
): Promise<void> {
  const keyValue = options.keyValue ?? defaultAuthDeps().keyValue;
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
