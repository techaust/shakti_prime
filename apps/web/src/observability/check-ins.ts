import { logger } from '../log';
import { checkInMarginMinutes, JOB_SCHEDULES, type ScheduledRoute } from '../workers/schedules';
import { SENTRY_FLUSH_MS, sentryDsnSet } from './sentry-on';

/**
 * Tells Sentry's cron monitor of a scheduled route that a call ran (`ok`) or failed (`error`),
 * with the monitor's schedule, so Sentry makes the monitor on its first check-in and raises a
 * missed run when QStash stops calling: a deleted schedule, an old signing key, a paused project
 * (audit 2026-10, OPS-4). The monitor is named by the schedule's id; Sentry keeps each
 * environment apart. Flushed before it resolves; never fails the caller; nothing without a DSN.
 */
export async function sendCheckIn(job: ScheduledRoute, status: 'ok' | 'error'): Promise<void> {
  if (!sentryDsnSet()) return;
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
