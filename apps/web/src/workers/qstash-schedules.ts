import {
  DUPLICATE_SCAN_PATH,
  FILES_SWEEP_PATH,
  JOBS_CHECK_PATH,
  LEAD_ANONYMISE_PATH,
  LEAD_RESCORE_PATH,
  NOTIFICATION_SCAN_PATH,
  OUTBOX_PUBLISH_PATH,
  QUOTE_EXPIRE_PATH,
} from './qstash';
import { JOB_SCHEDULES, type ScheduledRoute } from './schedules';

/** The hosted environments, each with its own schedules on the one QStash account. */
export const HOSTED_ENVIRONMENTS = ['dev', 'staging', 'production'] as const;
export type HostedEnvironment = (typeof HOSTED_ENVIRONMENTS)[number];

export function hostedEnvironment(value: string | undefined): HostedEnvironment | undefined {
  return HOSTED_ENVIRONMENTS.find((name) => name === value);
}

/** One QStash schedule, as `apps/web/scripts/qstash-schedule.ts` creates or updates it. */
export interface QStashSchedule {
  /** `<route>-<environment>`, so one environment's run never overwrites another's. */
  scheduleId: string;
  route: ScheduledRoute;
  destination: string;
  cron: string;
  retries: number;
  timeout: number;
}

/**
 * Each timed worker route: its path, how often QStash retries a failed call and how long a call
 * may take, in seconds. A job that runs every minute, five minutes or hour is not retried, since
 * the next call covers a missed one; a nightly or daily job is retried three times.
 */
const ROUTES: Record<ScheduledRoute, { path: string; retries: number; timeout: number }> = {
  'outbox-publish': { path: OUTBOX_PUBLISH_PATH, retries: 0, timeout: 30 },
  'files-sweep': { path: FILES_SWEEP_PATH, retries: 0, timeout: 60 },
  'lead-rescore': { path: LEAD_RESCORE_PATH, retries: 3, timeout: 60 },
  'duplicate-scan': { path: DUPLICATE_SCAN_PATH, retries: 3, timeout: 60 },
  'lead-anonymise': { path: LEAD_ANONYMISE_PATH, retries: 3, timeout: 60 },
  'quote-expire': { path: QUOTE_EXPIRE_PATH, retries: 3, timeout: 60 },
  'notification-scan': { path: NOTIFICATION_SCAN_PATH, retries: 0, timeout: 60 },
  'jobs-check': { path: JOBS_CHECK_PATH, retries: 0, timeout: 30 },
};

/**
 * Every schedule an environment needs, on its site (`siteUrl` is any address there, such as the
 * publisher's), on the crons of `JOB_SCHEDULES` that the routes' Sentry check-ins also read.
 */
export function qstashSchedules(environment: HostedEnvironment, siteUrl: string): QStashSchedule[] {
  return (Object.keys(JOB_SCHEDULES) as ScheduledRoute[]).map((route) => ({
    scheduleId: `${route}-${environment}`,
    route,
    destination: new URL(ROUTES[route].path, siteUrl).toString(),
    cron: JOB_SCHEDULES[route],
    retries: ROUTES[route].retries,
    timeout: ROUTES[route].timeout,
  }));
}
