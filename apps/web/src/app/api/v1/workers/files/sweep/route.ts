import { fileStore } from '../../../../../../files/store';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { purgeImports } from '../../../../../../workers/files/purge-imports';
import { sweepAbandonedUploads } from '../../../../../../workers/files/sweep-uploads';
import { recordJobOutcome } from '../../../../../../workers/job-streak';
import {
  FILES_SWEEP_PATH,
  fromSchedule,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';
import { NO_RETRY, workerFailure } from '../../../../../../workers/route-answers';

export const dynamic = 'force-dynamic';
/** Seconds; a run refuses at most a few hundred uploads a company. */
export const maxDuration = 60;

/**
 * How long a run keeps starting import purges after the sweep, well inside `maxDuration`: a call
 * clears at most twenty jobs, and the next hour's run takes the rest.
 */
const IMPORT_PURGE_BUDGET_MS = 30_000;

/**
 * The sweep of abandoned uploads (docs/03-roadmap-appendix/phase1.md §6.3, docs/06-api.md §3.6),
 * then the import purge (audit SEC-1: import files deleted once their job ends or after a week,
 * rows cleared after the reconciliation period; `purgeImports`). Only the QStash
 * schedule calls it, every hour: every call must carry a valid signature for this route and body.
 * The schedule asks for no retries, so a run that fails answers 500 and is not tried again; that
 * is harmless, as the next hour's run carries on where it stopped; the third failed hour in a row
 * tells the owner (`recordJobOutcome`).
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return workerFailure('integration_unavailable', requestId, headers);

  const body = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (body === undefined) {
    logger.log('warn', 'files.sweep_too_large', { requestId });
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    body,
    workerUrl(config, FILES_SWEEP_PATH),
  );
  if (!signed) {
    logger.log('warn', 'files.sweep_refused', { requestId });
    return workerFailure('unauthorized', requestId, headers);
  }

  const scheduled = fromSchedule(request.headers);
  try {
    const store = fileStore();
    const swept = await sweepAbandonedUploads({ store, requestId });
    const imports = await purgeImports({ store, requestId, budgetMs: IMPORT_PURGE_BUDGET_MS });
    await recordJobOutcome('files-sweep', 'ok', { requestId, scheduled });
    return Response.json({ ...swept, imports }, { headers });
  } catch (error) {
    logger.log('error', 'files.sweep_failed', { requestId, error });
    await recordJobOutcome('files-sweep', 'failed', { requestId, scheduled });
    return workerFailure('internal', requestId, headers);
  }
}
