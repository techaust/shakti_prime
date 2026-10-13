import { JobsCheckWorkerBody } from '@shakti/contracts';
import { runJobsCheck } from '../../../../../../workers/jobs-check';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { JOBS_CHECK_PATH } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; one read of the jobs and at most a few alerts. */
export const maxDuration = 30;

/**
 * The hourly check of the database's scheduled jobs (docs/06-api.md §3.6, audit 2026-10 DATA-3).
 * Only QStash calls it, on the schedule `jobs-check-<environment>` (`nightlyWorkerRoute`).
 */
export const POST = nightlyWorkerRoute({
  path: JOBS_CHECK_PATH,
  job: 'jobs-check',
  logPrefix: 'jobs.check',
  body: JobsCheckWorkerBody,
  budgetMs: 20_000,
  run: (_body, { requestId }) => runJobsCheck({ requestId }),
});
