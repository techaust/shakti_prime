import { JobsCheckWorkerResponse } from '@shakti/contracts';
import { executeQuery, readScheduledJobs, type KeyValue } from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';
import { systemWorkersPrincipal } from './events/system-principal';

/** How long one alert for a job's problem stands before the check raises it again. */
const ALERT_AGAIN_SECONDS = 7 * 24 * 60 * 60;

export interface JobsCheckOptions {
  requestId: string;
  keyValue?: KeyValue;
  alerts?: AlertSink;
  now?: Date;
}

/**
 * The hourly check of the database's scheduled jobs (audit 2026-10, DATA-3): reads each job's last
 * run as `system:workers`, which holds the platform-only `platform.jobs.check` and nothing of
 * any company, and tells the owner of each job that failed, is stuck, is late, is paused or is missing
 * (`job.problem`, with the job and its state). Each problem is raised once per job, state and last
 * run, and again after a week while it lasts; the error behind a failure goes to the log, redacted,
 * never into the alert.
 */
export async function runJobsCheck(options: JobsCheckOptions): Promise<JobsCheckWorkerResponse> {
  const { requestId } = options;
  const keyValue = options.keyValue ?? defaultAuthDeps().keyValue;
  const alerts = options.alerts ?? sentryAlertSink;
  const now = options.now ?? new Date();
  const reports = await executeQuery(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId },
    (context) => readScheduledJobs(context, now),
    { name: 'jobsCheck' },
  );
  let problems = 0;
  let alerted = 0;
  for (const { health, error } of reports) {
    if (health.state === 'ok' || health.state === 'running' || health.state === 'waiting') continue;
    problems += 1;
    logger.log('warn', 'jobs.problem', {
      requestId,
      job: health.job,
      state: health.state,
      lastRunAt: health.lastRunAt,
      error,
    });
    const key = `job:problem:${health.job}:${health.state}:${health.lastRunAt ?? 'never'}`;
    let first: boolean;
    try {
      first = await keyValue.setIfAbsent(key, '1', ALERT_AGAIN_SECONDS);
    } catch (storeError) {
      // Without the store the check cannot tell a repeat: telling twice beats not telling.
      logger.log('warn', 'jobs.alert_not_kept', { requestId, job: health.job, error: storeError });
      first = true;
    }
    if (!first) continue;
    await alerts.report('job.problem', { job: health.job, problem: health.state });
    alerted += 1;
  }
  return JobsCheckWorkerResponse.parse({ jobs: reports.length, problems, alerted });
}
