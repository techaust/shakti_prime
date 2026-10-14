import {
  DomainError,
  IMPORT_FILE_PURGE_LIMIT,
  type ImportPurgeJob,
  type ImportRowsPurgeDto,
  type Principal,
} from '@shakti/contracts';
import {
  companyStanding,
  executeCommand,
  executeQuery,
  importFilesToDelete,
  maskImportIdentity,
  nextImportJobToCheck,
  purgeImportRows,
  recordImportFilesDeleted,
  recordImportPurgeFailure,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';

/** Store refusals in a row after which a company's files wait for the next hour. */
const STORE_REFUSALS_IN_A_ROW = 3;

export interface ImportPurgeDeps {
  /** The environment's store, whose import files the purge deletes; none where no store exists. */
  store: FileStore | undefined;
  requestId: string;
  logger?: Logger;
  /** Start no new call after this long; the next hour's run carries on. */
  budgetMs?: number;
  now?: () => number;
}

export interface ImportPurgeResult {
  companies: number;
  /** Jobs made before the identity-number rule that this run finished checking (the one-off pass). */
  jobsChecked: number;
  filesDeleted: number;
  jobsPurged: number;
  rowsCleared: number;
  /** Calls that failed, each recorded in `retention_runs` by its code and passed by. */
  failures: number;
}

/** A failure by its code alone: a domain code, or the SQLSTATE of the database's refusal. */
export function failureCode(error: unknown): string {
  if (error instanceof DomainError) return error.code;
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 4; depth += 1) {
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^(?:[0-9a-z]{5}|[a-z_]{1,40})$/.test(code.toLowerCase())) {
      return code.toLowerCase();
    }
    e = e.cause;
  }
  return 'internal';
}

/**
 * The import purge (audit SEC-1, BLUEPRINT §7.9), run with the sweep of abandoned uploads every
 * hour by the worker principal: for each company in turn, archived ones included, in a request for
 * that company alone,
 * 0. the jobs imported before the identity-number rule are checked, a thousand rows a call
 *    (`nextImportJobToCheck`, `imports.job.mask_identity`), a one-off pass that then finds none;
 * 1. the import files of this store whose job ended, or that were uploaded more than the open
 *    period ago, page by page (`importFilesToDelete`), are deleted with every version the store
 *    kept, then recorded deleted (`imports.file.record_deleted`); a file the store refuses is
 *    logged by its id, recorded by its code and paged past, so it never holds the rest back, and
 *    it is never recorded deleted while its bytes remain; after three refusals in a row the
 *    company's files wait for the next hour;
 * 2. the rows of the import jobs past the reconciliation period are cleared, a call at a time,
 *    until none is left (`imports.job.purge`).
 * A call that fails is recorded in `retention_runs` by its code (`imports.purge.record_failure`):
 * a job the pass could not check is passed by until the next hour, and a company whose part
 * failed is left for the next hour while the others go on (review M4). Without a store (a build
 * with none) the files wait. The budget is checked between calls, so a run starts no new call
 * after it.
 */
export async function purgeImports(deps: ImportPurgeDeps): Promise<ImportPurgeResult> {
  const log = deps.logger ?? appLogger;
  const now = deps.now ?? Date.now;
  const started = now();
  const spent = () => deps.budgetMs !== undefined && now() - started >= deps.budgetMs;
  const result: ImportPurgeResult = {
    companies: 0,
    jobsChecked: 0,
    filesDeleted: 0,
    jobsPurged: 0,
    rowsCleared: 0,
    failures: 0,
  };
  const call = (entityId: number) => ({ entityIds: [entityId], requestId: deps.requestId });

  /** Logs and records one failed call; a failure to record it is logged too and goes no further. */
  const failed = async (
    principal: Principal,
    entityId: number,
    job: ImportPurgeJob,
    error: unknown,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    result.failures += 1;
    const code = failureCode(error);
    log.log('error', 'imports.purge_failed', {
      requestId: deps.requestId,
      entityId,
      job,
      code,
      ...extra,
    });
    try {
      await executeCommand(principal, call(entityId), recordImportPurgeFailure, {
        entityId,
        job,
        error: code,
      });
    } catch (recordError) {
      log.log('error', 'imports.purge_failure_unrecorded', {
        requestId: deps.requestId,
        entityId,
        error: recordError,
      });
    }
  };

  for (let entityId = 1; !spent(); entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      call(entityId),
      (ctx) => companyStanding(ctx, entityId),
      { name: 'imports.purge.company' },
    );
    if (standing === 'missing') break;
    result.companies += 1;

    // 0. The one-off identity pass, job by job; a job that fails is passed by this hour.
    const skip = new Set<string>();
    try {
      while (!spent()) {
        const jobId = await executeQuery(
          principal,
          call(entityId),
          (ctx) => nextImportJobToCheck(ctx, entityId, [...skip]),
          { name: 'imports.purge.nextCheck' },
        );
        if (jobId === null) break;
        try {
          const part = await executeCommand(principal, call(entityId), maskImportIdentity, {
            entityId,
            jobId,
          });
          // Another run holds it, or it was checked meanwhile.
          if (part.jobId === null) skip.add(jobId);
          else if (part.done) result.jobsChecked += 1;
        } catch (error) {
          skip.add(jobId);
          await failed(principal, entityId, 'import-identity-check', error, { jobId });
        }
      }
    } catch (error) {
      await failed(principal, entityId, 'import-identity-check', error);
    }

    // 1. The files, page by page, paging past any the store refused.
    const store = deps.store;
    if (store !== undefined) {
      try {
        let after: string | undefined;
        // A store that refuses several deletions in a row is left alone until the next hour.
        let refusedInARow = 0;
        while (!spent() && refusedInARow < STORE_REFUSALS_IN_A_ROW) {
          const page = await executeQuery(
            principal,
            call(entityId),
            (ctx) =>
              importFilesToDelete(ctx, entityId, {
                bucket: store.bucket,
                now: new Date(now()),
                after,
              }),
            { name: 'imports.purge.files' },
          );
          const deleted: string[] = [];
          for (const file of page) {
            try {
              await store.delete(file.key);
              deleted.push(file.id);
              refusedInARow = 0;
            } catch (error) {
              await failed(principal, entityId, 'import-files-purge', error, { fileId: file.id });
              refusedInARow += 1;
              if (refusedInARow >= STORE_REFUSALS_IN_A_ROW) break;
            }
          }
          if (deleted.length > 0) {
            const recorded = await executeCommand(
              principal,
              call(entityId),
              recordImportFilesDeleted,
              { entityId, fileIds: deleted },
            );
            result.filesDeleted += recorded.deleted;
          }
          const last = page.at(-1);
          if (page.length < IMPORT_FILE_PURGE_LIMIT || last === undefined) break;
          after = last.id;
        }
      } catch (error) {
        await failed(principal, entityId, 'import-files-purge', error);
      }
    }

    // 2. The rows past the reconciliation period.
    try {
      while (!spent()) {
        const batch: ImportRowsPurgeDto = await executeCommand(
          principal,
          call(entityId),
          purgeImportRows,
          { entityId },
        );
        result.jobsPurged += batch.jobs;
        result.rowsCleared += batch.rows;
        if (!batch.more) break;
      }
    } catch (error) {
      await failed(principal, entityId, 'import-rows-purge', error);
    }
  }
  log.log('info', 'imports.purge_run', { requestId: deps.requestId, ...result });
  return result;
}
