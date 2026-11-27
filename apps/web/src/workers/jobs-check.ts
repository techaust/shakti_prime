import { JobsCheckWorkerResponse } from '@shakti/contracts';
import {
  executeQuery,
  istCalendarDate,
  readScheduledJobs,
  type AlertCounts,
  type KeyValue,
} from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';
import { BACKUP_JOB, backupProblem, configuredBackupCheck, type BackupListing } from './backup-age';
import { systemWorkersPrincipal } from './events/system-principal';
import { PHASE2_ALERTS_JOB, PHASE2_ALERTS_TIMEOUT_MS, runPhase2Alerts } from './phase2-alerts';
import { runTallyAlerts, TALLY_ALERTS_JOB } from './tally-alerts';

/** How long one alert for a job's problem stands before the check raises it again. */
const ALERT_AGAIN_SECONDS = 7 * 24 * 60 * 60;

export interface JobsCheckOptions {
  requestId: string;
  keyValue?: KeyValue;
  alerts?: AlertSink;
  now?: Date;
  /** The database copies' listing; by default production's bucket (`BACKUP_BUCKET`), else none. */
  backups?: { listing: BackupListing; environment: string } | null;
  /** The Phase 2 alerts' counts; by default `app.alert_counts()` as `system:workers` (tests). */
  readAlertCounts?: () => Promise<AlertCounts>;
  /** How long the Phase 2 alerts may take; `PHASE2_ALERTS_TIMEOUT_MS` by default (tests). */
  phase2TimeoutMs?: number;
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
  const tell = async (job: string, state: string, since: string): Promise<void> => {
    const key = `job:problem:${job}:${state}:${since}`;
    let first: boolean;
    try {
      first = await keyValue.setIfAbsent(key, '1', ALERT_AGAIN_SECONDS);
    } catch (storeError) {
      // Without the store the check cannot tell a repeat: telling twice beats not telling.
      logger.log('warn', 'jobs.alert_not_kept', { requestId, job, error: storeError });
      first = true;
    }
    if (!first) return;
    await alerts.report('job.problem', { job, problem: state });
    alerted += 1;
  };
  for (const { job, state, since } of problems) await tell(job, state, since);
  // TC2's Tally connector alerts: a fault in them is told once a day, as the Phase 2 alerts' is,
  // and never fails this check.
  let tallyFailed = false;
  try {
    alerted += (await runTallyAlerts({ requestId, alerts, now })).alerted;
  } catch (error) {
    tallyFailed = true;
    logger.log('warn', 'jobs.problem', { requestId, job: TALLY_ALERTS_JOB, state: 'failed', error });
    await tell(TALLY_ALERTS_JOB, 'failed', istCalendarDate(now));
  }
  // G2's Phase 2 alerts (g2-alerts), after the jobs' own. A fault in them never fails this check,
  // so it can neither hold the check's own streak (`job.failing`) nor keep a job's problem untold;
  // it is told once a day as a problem of its own (`phase2-alerts`, `failed`). They may take at
  // most `PHASE2_ALERTS_TIMEOUT_MS`, so the route answers inside its time with its check-in sent;
  // one that runs longer counts as failed.
  let phase2Failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = options.phase2TimeoutMs ?? PHASE2_ALERTS_TIMEOUT_MS;
    const phase2 = await Promise.race([
      runPhase2Alerts({
        requestId,
        keyValue,
        alerts,
        now,
        ...(options.readAlertCounts === undefined ? {} : { readCounts: options.readAlertCounts }),
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`the Phase 2 alerts took longer than ${String(timeoutMs)} ms`));
        }, timeoutMs);
      }),
    ]);
    alerted += phase2.alerted;
  } catch (error) {
    phase2Failed = true;
    logger.log('warn', 'jobs.problem', {
      requestId,
      job: PHASE2_ALERTS_JOB,
      state: 'failed',
      error,
    });
    await tell(PHASE2_ALERTS_JOB, 'failed', istCalendarDate(now));
  } finally {
    clearTimeout(timer);
  }
  const jobs = reports.length + (backups === null || backups === undefined ? 0 : 1);
  return JobsCheckWorkerResponse.parse({
    jobs,
    problems: problems.length + (phase2Failed ? 1 : 0) + (tallyFailed ? 1 : 0),
    alerted,
  });
}
