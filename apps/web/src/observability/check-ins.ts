import { logger } from '../log';
import { checkInMarginMinutes, JOB_SCHEDULES, type ScheduledRoute } from '../workers/schedules';
import { SENTRY_FLUSH_MS, sentryDsnSet } from './sentry-on';

/**
 * The cron monitors Sentry holds, by environment. Sentry stays on its free plan, which holds one
 * cron monitor (DECISIONS, 15-10-2026): production's outbox publisher, which nothing in the app
 * can watch when QStash stops calling it. Every other job is watched by the in-app alerts
 * `job.failing` and `job.problem` (docs/runbooks/deploy.md §1 step 8), and dev and staging check
 * nothing in.
 */
export const MONITORED_JOBS: Readonly<Record<string, readonly ScheduledRoute[]>> = {
  production: ['outbox-publish'],
};

/** Whether a call of `job` checks in to a Sentry cron monitor in this environment. */
export function monitored(job: ScheduledRoute, env: NodeJS.ProcessEnv = process.env): boolean {
  const environment = env.BOS_ENVIRONMENT ?? '';
  return (
    Object.hasOwn(MONITORED_JOBS, environment) && (MONITORED_JOBS[environment] ?? []).includes(job)
  );
}

/**
 * Tells Sentry's cron monitor of a scheduled route that a call ran (`ok`) or failed (`error`),
 * with the monitor's schedule, so Sentry makes the monitor on its first check-in and raises a
 * missed run when QStash stops calling: a deleted schedule, an old signing key, a paused project
 * (audit 2026-10, OPS-4). The monitor is named by the schedule's id; Sentry keeps each
 * environment apart. Flushed before it resolves; never fails the caller; nothing without a DSN.
 */
export async function sendCheckIn(job: ScheduledRoute, status: 'ok' | 'error'): Promise<void> {
  if (!sentryDsnSet() || !monitored(job)) return;
  try {
    const sentry = await import('@sentry/nextjs');
    sentry.captureCheckIn(
      { monitorSlug: job, status },
      {
        schedule: { type: 'crontab', value: JOB_SCHEDULES[job] },
        checkinMargin: checkInMarginMinutes(job),
        maxRuntime: 5,
        timezone: 'Etc/UTC',
      },
    );
    await sentry.flush(SENTRY_FLUSH_MS);
  } catch (error) {
    logger.log('warn', 'job.check_in_failed', { job, error });
  }
}
