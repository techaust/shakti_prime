import {
  DomainError,
  ImportCommitWorkerResponse,
  type ImportCommitWorkerBody,
  type Principal,
} from '@shakti/contracts';
import { loadUserGrants } from '@shakti/db/grants';
import {
  commitImportBatch,
  executeCommand,
  failImportJob,
  resolvePrincipalFromGrants,
} from '@shakti/domain';
import { hostedRuntime } from '../auth/deps';
import { logger } from '../log';
import { nudgeOutbox } from './outbox';
import { publishImportCommit, qstashConfig } from './qstash';

/**
 * How long one hosted worker call keeps starting batches before it hands the rest to a fresh
 * call. A batch started just inside it may still run for its own budget
 * (`IMPORT_BATCH_BUDGET_MS`, 20 seconds: it tries the set-based path only while the slowest
 * measured set-based batch still fits, and row by row it stops between rows once the time is
 * spent) and then one more row, so the whole aims to stay well inside the route's `maxDuration`
 * of 60 seconds.
 */
export const IMPORT_RUN_BUDGET_MS = 30_000;

/**
 * Batches one run commits in the dev server, where no queue exists: a small file finishes before
 * the commit action answers, and a large one carries on in the background, a few batches at a time.
 */
export const LOCAL_BATCHES_PER_RUN = 4;

/**
 * The person who asked for the commit, as they stand now, and the companies the job's request
 * acts for: the job's own company, or, for a customers file naming other companies and for the
 * PIN code master, every company the commit was asked for that the person still holds. A
 * suspended user, or one who has lost the import permission, commits nothing more.
 */
async function importPrincipal(
  body: ImportCommitWorkerBody,
): Promise<{ principal: Principal; entityIds: number[] }> {
  const grants = await loadUserGrants(body.userId);
  const outcome =
    body.entityIds === undefined
      ? resolvePrincipalFromGrants(body.userId, grants, body.entityId)
      : resolvePrincipalFromGrants(body.userId, grants);
  if (outcome.kind !== 'principal') {
    throw new DomainError('forbidden', `import worker cannot act for the user (${outcome.kind})`);
  }
  const held = outcome.principal.entityIds;
  const entityIds = (body.entityIds ?? [body.entityId]).filter((id) => held.includes(id));
  if (!entityIds.includes(body.entityId)) {
    throw new DomainError('forbidden', 'import worker cannot act in the job company');
  }
  return { principal: outcome.principal, entityIds };
}

export interface ImportRunOptions {
  /** Stop taking new batches after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  /** Stop after this many batches; unlimited when undefined. */
  maxBatches?: number | undefined;
  now?: () => number;
  /**
   * The request id of the call that started the run (the worker route's own), carried by every
   * batch's audit rows and by the run's log lines, so the two can be read together.
   */
  requestId?: string | undefined;
}

/**
 * Commits a job batch by batch (docs/design/backend-weeks-3-5.md §8), each batch one
 * `imports.job.commit_batch` in its own transaction, until the job is committed or failed, or
 * until the time or batch budget runs out; then the rest is handed to a new run.
 */
export async function runImportCommit(
  body: ImportCommitWorkerBody,
  options: ImportRunOptions = {},
): Promise<ImportCommitWorkerResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const { principal, entityIds } = await importPrincipal(body);
  const { requestId } = options;
  let batches = 0;
  for (;;) {
    const job = await executeCommand(
      principal,
      requestId === undefined ? { entityIds } : { entityIds, requestId },
      commitImportBatch,
      { entityId: body.entityId, jobId: body.jobId },
      { onCommitted: nudgeOutbox },
    );
    const answer = () =>
      ImportCommitWorkerResponse.parse({
        jobId: job.id,
        state: job.state,
        batches,
        committedRows: job.committedRows,
      });
    if (job.state !== 'committing') {
      logger.log('info', 'imports.commit_run', {
        requestId,
        jobId: job.id,
        state: job.state,
        batches,
      });
      return answer();
    }
    batches += 1;
    const outOfTime = options.budgetMs !== undefined && now() - started >= options.budgetMs;
    const outOfBatches = options.maxBatches !== undefined && batches >= options.maxBatches;
    if (outOfTime || outOfBatches) {
      await scheduleImportCommit(body, job.committedRows, { background: true });
      logger.log('info', 'imports.commit_continued', { requestId, jobId: job.id, batches });
      return answer();
    }
  }
}

/**
 * After the queue's last retry of a worker call failed (docs/design/phase1.md §6.3): the job stops
 * as `failed` through `imports.job.fail`, as the person who asked for the commit, instead of
 * waiting as committing for ever. Answers the job as it now stands.
 */
export async function giveUpImportCommit(
  body: ImportCommitWorkerBody,
  requestId: string,
): Promise<ImportCommitWorkerResponse> {
  const { principal, entityIds } = await importPrincipal(body);
  const job = await executeCommand(
    principal,
    { entityIds, requestId },
    failImportJob,
    { entityId: body.entityId, jobId: body.jobId },
    { onCommitted: nudgeOutbox },
  );
  logger.log('warn', 'imports.commit_gave_up', { requestId, jobId: job.id, state: job.state });
  return ImportCommitWorkerResponse.parse({
    jobId: job.id,
    state: job.state,
    batches: 0,
    committedRows: job.committedRows,
  });
}

/**
 * The queue's deduplication id for a run of a job: the job and how far it had got. A retried
 * hand-over, or a second click on Commit, names the same run and QStash sends it once.
 */
export function importRunId(jobId: string, committedRows: number): string {
  return `import-${jobId}-${String(committedRows)}`;
}

/**
 * Starts a run of the import worker for a job: through QStash when it is configured, so the work
 * survives the call that asked for it; in the dev server, with no queue, in this process, a few
 * batches at a time. `background` hands a local run to the event loop instead of waiting for it,
 * as the next run of a large file is.
 */
export async function scheduleImportCommit(
  body: ImportCommitWorkerBody,
  committedRows: number,
  options: { background?: boolean } = {},
): Promise<void> {
  const config = qstashConfig();
  if (config !== undefined) {
    await publishImportCommit(config, body, importRunId(body.jobId, committedRows));
    return;
  }
  if (hostedRuntime()) {
    throw new DomainError('integration_unavailable', 'no queue for the import worker');
  }
  const run = () => runImportCommit(body, { maxBatches: LOCAL_BATCHES_PER_RUN });
  if (options.background !== true) {
    await run();
    return;
  }
  setTimeout(() => {
    run().catch((error: unknown) => {
      logger.log('error', 'imports.commit_failed', { jobId: body.jobId, error });
    });
  }, 0);
}
