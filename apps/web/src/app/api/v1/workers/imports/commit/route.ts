import {
  DomainError,
  ErrorEnvelope,
  ImportCommitWorkerBody,
  type ErrorCode,
} from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import {
  giveUpImportCommit,
  IMPORT_RUN_BUDGET_MS,
  runImportCommit,
} from '../../../../../../workers/imports';
import {
  IMPORT_COMMIT_PATH,
  IMPORT_COMMIT_RETRIES,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`IMPORT_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The import commit worker (docs/03-roadmap-appendix/backend-weeks-3-5.md §8, docs/06-api.md §3.6). Only QStash
 * calls it, after `imports.job.commit` and again while a job has rows left: every call must carry
 * a valid signature for this route and body. A 500 makes QStash retry; a job the caller may no
 * longer commit answers 403 and QStash is told not to retry. A run that waited too long for a
 * lock (the job's row, held by an overlapping run of the same job, or a row a batch needs) or
 * whose statement was cut off answers 503, which QStash retries, and is logged as a warning: the
 * job is not at fault and is not failed. A call that cannot go on, because the person who asked
 * for the commit may no longer (suspended, or without the permission or a company the rows name),
 * or the queue's last retry (`Upstash-Retried`) failing whatever the cause, fails the job instead
 * (`imports.job.fail`, as the worker principal), so it never waits for ever.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', 503, requestId, headers);

  // Only a few ids ever come in: a larger body is refused before it is read (request-body.ts).
  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'imports.commit_too_large', { requestId });
    return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, IMPORT_COMMIT_PATH),
  );
  if (!signed) {
    logger.log('warn', 'imports.commit_refused', { requestId });
    return failure('unauthorized', 401, requestId, headers);
  }

  let body: ImportCommitWorkerBody;
  try {
    body = ImportCommitWorkerBody.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
  }

  try {
    const result = await runImportCommit(body, { budgetMs: IMPORT_RUN_BUDGET_MS, requestId });
    return Response.json(result, { headers });
  } catch (error) {
    const forbidden = error instanceof DomainError && error.code === 'forbidden';
    if (forbidden || isLastRetry(request.headers)) {
      if (forbidden) {
        logger.log('warn', 'imports.commit_forbidden', { requestId, jobId: body.jobId, error });
      }
      try {
        return Response.json(await giveUpImportCommit(body, requestId), { headers });
      } catch (giveUpError) {
        logger.log('error', 'imports.commit_give_up_failed', {
          requestId,
          jobId: body.jobId,
          error: giveUpError,
        });
      }
    }
    if (isRetryableWait(error)) {
      logger.log('warn', 'imports.commit_job_busy', { requestId, jobId: body.jobId });
      return failure('integration_unavailable', 503, requestId, headers);
    }
    if (forbidden) return failure('forbidden', 403, requestId, { ...headers, ...NO_RETRY });
    logger.log('error', 'imports.commit_failed', { requestId, jobId: body.jobId, error });
    return failure('internal', 500, requestId, headers);
  }
}

/**
 * A lock wait that ran out (`lock_not_available`), as when a retry of one QStash message overlaps
 * the run it retries, or a statement cut off (`query_canceled`).
 */
function isRetryableWait(error: unknown): boolean {
  const state = error instanceof DomainError ? error.details?.sqlstate : undefined;
  return state === '55P03' || state === '57014';
}

/** The call QStash makes after its last retry has failed: `Upstash-Retried` counts the retries. */
function isLastRetry(headers: Headers): boolean {
  const retried = Number.parseInt(headers.get('upstash-retried') ?? '0', 10);
  return Number.isFinite(retried) && retried >= IMPORT_COMMIT_RETRIES;
}

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

function failure(
  code: Extract<
    ErrorCode,
    'integration_unavailable' | 'unauthorized' | 'validation_failed' | 'forbidden' | 'internal'
  >,
  status: number,
  requestId: string,
  headers: Record<string, string>,
): Response {
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status, headers });
}
