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
import { IMPORT_RUN_BUDGET_MS, runImportCommit } from '../../../../../../workers/imports';
import {
  IMPORT_COMMIT_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`IMPORT_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The import commit worker (docs/design/backend-weeks-3-5.md §8, docs/API.md §3.6). Only QStash
 * calls it, after `imports.job.commit` and again while a job has rows left: every call must carry
 * a valid signature for this route and body. A 500 makes QStash retry; a job the caller may no
 * longer commit answers 403 and QStash is told not to retry.
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
    const result = await runImportCommit(body, { budgetMs: IMPORT_RUN_BUDGET_MS });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'forbidden') {
      logger.log('warn', 'imports.commit_forbidden', { requestId, jobId: body.jobId, error });
      return failure('forbidden', 403, requestId, { ...headers, ...NO_RETRY });
    }
    logger.log('error', 'imports.commit_failed', { requestId, jobId: body.jobId, error });
    return failure('internal', 500, requestId, headers);
  }
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
