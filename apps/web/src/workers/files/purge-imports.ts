import { IMPORT_FILE_PURGE_LIMIT, type ImportRowsPurgeDto } from '@shakti/contracts';
import {
  companyStanding,
  executeCommand,
  executeQuery,
  importFilesToDelete,
  purgeImportRows,
  recordImportFilesDeleted,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';

export interface ImportPurgeDeps {
  /** The environment's store, whose import files the purge deletes; none where no store exists. */
  store: FileStore | undefined;
  requestId: string;
  logger?: Logger;
  /** Stop starting new work after this long; the next hour's run carries on. */
  budgetMs?: number;
  now?: () => number;
}

export interface ImportPurgeResult {
  companies: number;
  filesDeleted: number;
  jobsPurged: number;
  rowsCleared: number;
}

/**
 * The import purge (audit SEC-1, BLUEPRINT §7.9), run with the sweep of abandoned uploads every
 * hour by the worker principal: for each company in turn, archived ones included, in a request for
 * that company alone,
 * 1. the import files whose job has ended, or that were uploaded more than the open period ago
 *    (`importFilesToDelete`), are deleted from the store with every version it kept, then recorded
 *    deleted (`imports.file.record_deleted`); a file the store would not delete is logged and left
 *    for the next run, so a file is never recorded deleted while its bytes remain;
 * 2. the rows of the import jobs past the reconciliation period are cleared, a call at a time,
 *    until none is left (`imports.job.purge`).
 * Without a store (a build with none) the files wait, and only the rows are cleared.
 */
export async function purgeImports(deps: ImportPurgeDeps): Promise<ImportPurgeResult> {
  const log = deps.logger ?? appLogger;
  const now = deps.now ?? Date.now;
  const started = now();
  const spent = () => deps.budgetMs !== undefined && now() - started >= deps.budgetMs;
  const result: ImportPurgeResult = { companies: 0, filesDeleted: 0, jobsPurged: 0, rowsCleared: 0 };
  const call = (entityId: number) => ({ entityIds: [entityId], requestId: deps.requestId });
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

    if (deps.store !== undefined) {
      const files = await executeQuery(
        principal,
        call(entityId),
        (ctx) => importFilesToDelete(ctx, entityId, new Date(now())),
        { name: 'imports.purge.files' },
      );
      const deleted: string[] = [];
      for (const file of files.slice(0, IMPORT_FILE_PURGE_LIMIT)) {
        // A file kept in another store is not this store's to delete.
        if (file.bucket !== deps.store.bucket) continue;
        try {
          await deps.store.delete(file.key);
          deleted.push(file.id);
        } catch (error) {
          log.log('warn', 'imports.purge_delete_failed', { requestId: deps.requestId, error });
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
    }

    for (;;) {
      const batch: ImportRowsPurgeDto = await executeCommand(
        principal,
        call(entityId),
        purgeImportRows,
        { entityId },
      );
      result.jobsPurged += batch.jobs;
      result.rowsCleared += batch.rows;
      if (!batch.more || spent()) break;
    }
  }
  log.log('info', 'imports.purge_run', { requestId: deps.requestId, ...result });
  return result;
}
