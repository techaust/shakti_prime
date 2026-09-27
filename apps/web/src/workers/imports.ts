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
 * call, well inside the function's time limit.
 */
export const IMPORT_RUN_BUDGET_MS = 40_000;

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
  /** Stop after this long and hand the rest to a new call; unlimited when undefined. */
  budgetMs?: number | undefined;
  now?: () => number;
}

/**
 * Commits a job batch by batch (docs/design/backend-weeks-3-5.md §8), each batch one
 * `imports.job.commit_batch` in its own transaction, until the job is committed or failed or the
 * time budget runs out; then the rest is handed to a new call.
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
    if (job.state !== 'committing') {
      logger.log('info', 'imports.commit_run', { jobId: job.id, state: job.state, batches });
      return ImportCommitWorkerResponse.parse({
        jobId: job.id,
        state: job.state,
        batches,
        committedRows: job.committedRows,
      });
    }
    batches += 1;
    if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
      await scheduleImportCommit(body);
      logger.log('info', 'imports.commit_continued', { jobId: job.id, batches });
      return ImportCommitWorkerResponse.parse({
        jobId: job.id,
        state: job.state,
        batches,
        committedRows: job.committedRows,
      });
    }
  }
}

/**
 * Starts the import worker for a job after `imports.job.commit`: through QStash when it is
 * configured, so the work survives the request; locally, with no queue, in this process.
 */
export async function scheduleImportCommit(body: ImportCommitWorkerBody): Promise<void> {
  const config = qstashConfig();
  if (config !== undefined) {
    await publishImportCommit(config, body);
    return;
  }
  if (hostedRuntime()) {
    throw new DomainError('integration_unavailable', 'no queue for the import worker');
  }
  await runImportCommit(body);
}
