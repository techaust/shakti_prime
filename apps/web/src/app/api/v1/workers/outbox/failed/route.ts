import {
  ERROR_HTTP_STATUS,
  ErrorEnvelope,
  OutboxFailureCallback,
  type ErrorCode,
} from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { logger } from '../../../../../../log';
import { readTextWithin } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import {
  FAILURE_BODY_MAX_BYTES,
  failedEventId,
  holdBackFailure,
} from '../../../../../../workers/outbox-failures';
import {
  OUTBOX_FAILED_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

/**
 * QStash's failure callback for the event workers (docs/API.md §3.6): every event is published
 * with this address as its failure callback, so when a worker refuses an event for good, or still
 * fails after QStash's last retry, the event comes back here. The body is refused over 64 KiB
 * before it is read, the signature must name this address, and the event is then held back as a
 * dead letter with `worker_refused` or `worker_failed`, listed on Integration Health, reported to
 * the owner and replayed by Send again. A failure here answers a retryable 5xx.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, FAILURE_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'outbox.failure_too_large', { requestId });
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, OUTBOX_FAILED_PATH),
  );
  if (!signed) {
    logger.log('warn', 'outbox.failure_refused', { requestId });
    return failure('unauthorized', requestId, headers);
  }

  let callback: OutboxFailureCallback;
  try {
    callback = OutboxFailureCallback.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const eventId = failedEventId(callback);
  if (eventId === undefined) {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    return Response.json(await holdBackFailure(eventId, callback.status, { requestId }), {
      headers,
    });
  } catch (error) {
    logger.log('error', 'outbox.failure_not_held', { requestId, eventId, error });
    return failure('internal', requestId, headers);
  }
}

function failure(code: ErrorCode, requestId: string, headers: Record<string, string>): Response {
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status: ERROR_HTTP_STATUS[code], headers });
}
