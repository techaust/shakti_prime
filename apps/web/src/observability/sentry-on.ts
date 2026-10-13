/** Whether error reporting is on: Sentry is loaded at all only with a DSN. */
export function sentryDsnSet(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN;
  return dsn !== undefined && dsn.trim() !== '';
}

/**
 * How long a report waits for Sentry to take its events. A serverless function may be frozen as
 * soon as it answers, so an alert or an error line is sent and flushed before the work that
 * raised it is over, rather than left to a transport that may never run (audit 2026-10, OPS-8).
 */
export const SENTRY_FLUSH_MS = 2_000;

/**
 * The alerts the owner is notified of through Sentry (docs/runbooks/deploy.md §1 step 8): the
 * rule in Sentry matches the message, which is the alert's name. Kept here, beside nothing that
 * logs, so the logger and the alert sink can both read the list.
 * - `outbox.dead_lettered`, `outbox.publisher_failing`: the outbox (incidents §2);
 * - `job.failing`: a scheduled worker route failed three calls in a row (`job`, `runs`);
 * - `job.problem`: a database job failed its last run, or has not run for longer than its period
 *   (`job`, `problem`).
 */
export const ALERT_NAMES = [
  'outbox.dead_lettered',
  'outbox.publisher_failing',
  'job.failing',
  'job.problem',
] as const;
export type AlertName = (typeof ALERT_NAMES)[number];
