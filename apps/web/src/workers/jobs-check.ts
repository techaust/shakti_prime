import { JobsCheckWorkerResponse } from '@shakti/contracts';
import { executeQuery, readScheduledJobs, type KeyValue } from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';
import { BACKUP_JOB, backupProblem, configuredBackupCheck, type BackupListing } from './backup-age';
import { systemWorkersPrincipal } from './events/system-principal';

/** How long one alert for a job's problem stands before the check raises it again. */
const ALERT_AGAIN_SECONDS = 7 * 24 * 60 * 60;

export interface JobsCheckOptions {
  requestId: string;
  keyValue?: KeyValue;
  alerts?: AlertSink;
  now?: Date;
  /** The database copies' listing; by default production's bucket (`BACKUP_BUCKET`), else none. */
  backups?: { listing: BackupListing; environment: string } | null;
}

/**
 * The hourly check of the database's scheduled jobs (audit 2026-10, DATA-3): reads each job's last
 * run as `system:workers`, which holds the platform-only `platform.jobs.check` and nothing of
 * any company, and tells the owner of each job that failed, is stuck, is late, is paused or is missing
 * (`job.problem`, with the job and its state). Each problem is raised once per job, state and last
 * run, and again after a week while it lasts; the error behind a failure goes to the log, redacted,
 * never into the alert. Where the database is copied (production), the newest copy's age is
 * checked the same way (`database-backup`: `late` past 7 hours, `missing`, or `failed` when
 * the copies cannot be listed).
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
  const problems: { job: string; state: string; since: string }[] = [];
  for (const { health, error } of reports) {
    if (health.state === 'ok' || health.state === 'running' || health.state === 'waiting') continue;
    logger.log('warn', 'jobs.problem', {
      requestId,
      job: health.job,
      state: health.state,
      lastRunAt: health.lastRunAt,
      error,
    });
    problems.push({ job: health.job, state: health.state, since: health.lastRunAt ?? 'never' });
  }
  const backups = options.backups === undefined ? configuredBackupCheck() : options.backups;
  if (backups !== null && backups !== undefined) {
    try {
      const { problem, newest } = await backupProblem(backups.listing, backups.environment, now);
      if (problem !== undefined) {
        logger.log('warn', 'jobs.problem', { requestId, job: BACKUP_JOB, state: problem, newest });
        problems.push({ job: BACKUP_JOB, state: problem, since: newest ?? 'none' });
      }
    } catch (error) {
      logger.log('warn', 'jobs.problem', { requestId, job: BACKUP_JOB, state: 'failed', error });
      problems.push({ job: BACKUP_JOB, state: 'failed', since: 'listing' });
    }
  }
  let alerted = 0;
  for (const { job, state, since } of problems) {
    const key = `job:problem:${job}:${state}:${since}`;
    let first: boolean;
    try {
      first = await keyValue.setIfAbsent(key, '1', ALERT_AGAIN_SECONDS);
    } catch (storeError) {
      // Without the store the check cannot tell a repeat: telling twice beats not telling.
      logger.log('warn', 'jobs.alert_not_kept', { requestId, job, error: storeError });
      first = true;
    }
    if (!first) continue;
    await alerts.report('job.problem', { job, problem: state });
    alerted += 1;
  }
  const jobs = reports.length + (backups === null || backups === undefined ? 0 : 1);
  return JobsCheckWorkerResponse.parse({ jobs, problems: problems.length, alerted });
}
