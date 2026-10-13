/**
 * The worker routes QStash calls on a timer, by the id of their schedule without its environment,
 * with the cron each runs on (UTC). `apps/web/scripts/qstash-schedule.ts` makes the schedules from
 * these crons, and each route's Sentry check-in names the same schedule, so a monitor expects a
 * call exactly when QStash makes one.
 */
export const JOB_SCHEDULES = {
  'outbox-publish': '* * * * *',
  // Seventeen minutes past each hour, away from the top of the hour other jobs favour.
  'files-sweep': '17 * * * *',
  // 21:30 UTC, three in the morning in India, when no one is calling.
  'lead-rescore': '30 21 * * *',
  // Half an hour after the rescoring.
  'duplicate-scan': '0 22 * * *',
  // Five minutes after midnight in India, when the day's last valid quotes have lapsed.
  'quote-expire': '35 18 * * *',
  'notification-scan': '*/5 * * * *',
  // Away from the top of the hour and from the sweep.
  'jobs-check': '41 * * * *',
} as const;

export type ScheduledRoute = keyof typeof JOB_SCHEDULES;

/**
 * Minutes after its expected time before a monitor counts a call as missed: three for the minute
 * schedule, ten for the five-minute scan, twenty for an hourly one and an hour for a daily one,
 * since QStash may retry a daily call and a run may hand on the rest.
 */
export function checkInMarginMinutes(job: ScheduledRoute): number {
  const [minute = '*', hour = '*'] = JOB_SCHEDULES[job].split(' ');
  if (minute === '*') return 3;
  if (minute.startsWith('*/')) return 10;
  if (hour === '*') return 20;
  return 60;
}
