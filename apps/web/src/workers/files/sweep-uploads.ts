import type { SweepUploadsDto } from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  staleUploadCompanies,
  sweepUploads,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';

/**
 * How long an upload may stay pending before the sweep refuses it: a day, far past the 15
 * minutes its upload address lasts, so an upload still going is never swept.
 */
export const SWEEP_AFTER_MINUTES = 24 * 60;

export interface SweepDeps {
  /** The environment's store, whose stray bytes the sweep deletes; none where no store exists. */
  store: FileStore | undefined;
  requestId: string;
  olderThanMinutes?: number;
  logger?: Logger;
}

/**
 * The sweep of abandoned uploads (docs/03-roadmap-appendix/phase1.md §6.3), run by the worker principal on a
 * schedule (`POST /api/v1/workers/files/sweep`): it asks which companies hold an upload still
 * pending a day after it began, then, in a request for each company alone, refuses those uploads
 * as abandoned (`files.upload.sweep`) and deletes whatever bytes landed under their keys. A
 * deletion that fails is logged; the record already says the upload is gone.
 */
export async function sweepAbandonedUploads(
  deps: SweepDeps,
): Promise<{ companies: number; abandoned: number }> {
  const log = deps.logger ?? appLogger;
  const olderThanMinutes = deps.olderThanMinutes ?? SWEEP_AFTER_MINUTES;
  const companies = await executeQuery(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId: deps.requestId },
    (ctx) => staleUploadCompanies(ctx, olderThanMinutes),
    { name: 'files.sweep.companies' },
  );
  let abandoned = 0;
  for (const entityId of companies) {
    const swept: SweepUploadsDto = await executeCommand(
      systemWorkersPrincipal(entityId),
      { entityIds: [entityId], requestId: deps.requestId },
      sweepUploads,
      { olderThanMinutes },
    );
    abandoned += swept.abandoned;
    for (const key of swept.keys) {
      try {
        await deps.store?.delete(key);
      } catch (error) {
        log.log('warn', 'files.sweep_delete_failed', { requestId: deps.requestId, error });
      }
    }
  }
  log.log('info', 'files.sweep_run', {
    requestId: deps.requestId,
    companies: companies.length,
    abandoned,
  });
  return { companies: companies.length, abandoned };
}
