import {
  DomainError,
  ImportCommitWorkerResponse,
  type ImportCommitWorkerBody,
  type Principal,
} from '@shakti/contracts';
import { loadUserGrants } from '@shakti/db';
import { commitImportBatch, executeCommand, resolvePrincipalFromGrants } from '@shakti/domain';
import { hostedRuntime } from '../auth/deps';
import { logger } from '../log';
import { nudgeOutbox } from './outbox';
import { publishImportCommit, qstashConfig } from './qstash';

/**
 * How long one hosted worker call keeps committing batches before it hands the rest to a fresh
 * call, well inside the route's `maxDuration`.
 */
export const IMPORT_RUN_BUDGET_MS = 40_000;

/**
 * Batches one run commits in the dev server, where no queue exists: a small file finishes before
 * the commit action answers, and a large one carries on in the background, a few batches at a time.
 */
export const LOCAL_BATCHES_PER_RUN = 4;

/**
 * The person who asked for the commit, as they stand now and narrowed to the job's company: a
 * suspended user, or one who has lost the import permission there, commits nothing more.
 */
async function importPrincipal(userId: string, entityId: number): Promise<Principal> {
  const outcome = resolvePrincipalFromGrants(userId, await loadUserGrants(userId), entityId);
  if (outcome.kind !== 'principal') {
    throw new DomainError('forbidden', `import worker cannot act for the user (${outcome.kind})`);
  }
  return outcome.principal;
}

export interface ImportRunOptions {
  /** Stop taking new batches after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  /** Stop after this many batches; unlimited when undefined. */
  maxBatches?: number | undefined;
  now?: () => number;
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
  const principal = await importPrincipal(body.userId, body.entityId);
  let batches = 0;
  for (;;) {
    const job = await executeCommand(
      principal,
      { entityIds: [body.entityId] },
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
      logger.log('info', 'imports.commit_run', { jobId: job.id, state: job.state, batches });
      return answer();
    }
    batches += 1;
    const outOfTime = options.budgetMs !== undefined && now() - started >= options.budgetMs;
    const outOfBatches = options.maxBatches !== undefined && batches >= options.maxBatches;
    if (outOfTime || outOfBatches) {
      await scheduleImportCommit(body, job.committedRows, { background: true });
      logger.log('info', 'imports.commit_continued', { jobId: job.id, batches });
      return answer();
    }
  }
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
