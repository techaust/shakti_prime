import { ErrorEnvelope, type ErrorCode } from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { fileStore } from '../../../../../../files/store';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { sweepAbandonedUploads } from '../../../../../../workers/files/sweep-uploads';
import {
  FILES_SWEEP_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; a run refuses at most a few hundred uploads a company. */
export const maxDuration = 60;

/**
 * The sweep of abandoned uploads (docs/design/phase1.md §6.3, docs/API.md §3.6). Only the QStash
 * schedule calls it, every hour: every call must carry a valid signature for this route and body.
 * A 500 makes QStash retry; a run that fails part-way is harmless, as the next one carries on.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', 503, requestId, headers);

  const body = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (body === undefined) {
    logger.log('warn', 'files.sweep_too_large', { requestId });
    return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    body,
    workerUrl(config, FILES_SWEEP_PATH),
  );
  if (!signed) {
    logger.log('warn', 'files.sweep_refused', { requestId });
    return failure('unauthorized', 401, requestId, headers);
  }

  try {
    const swept = await sweepAbandonedUploads({ store: fileStore(), requestId });
    return Response.json(swept, { headers });
  } catch (error) {
    logger.log('error', 'files.sweep_failed', { requestId, error });
    return failure('internal', 500, requestId, headers);
  }
}

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

function failure(
  code: Extract<
    ErrorCode,
    'integration_unavailable' | 'unauthorized' | 'validation_failed' | 'internal'
  >,
  status: number,
  requestId: string,
  headers: Record<string, string>,
): Response {
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status, headers });
}
