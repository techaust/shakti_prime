import { ErrorEnvelope, OutboxPublishResponse, type ErrorCode } from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { publishOutbox } from '../../../../../../workers/outbox';
import { qstashConfig, verifyQStashSignature } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/**
 * A run claims, calls the queue once (5 seconds at most) and records the outcomes. Stopping the
 * function well inside the rows' two-minute lease means no run records after its lease is gone.
 */
export const maxDuration = 60;

/**
 * The outbox publisher (docs/design/backend-weeks-3-5.md §4.2, docs/API.md §3.6). Only QStash
 * calls it, from the minute schedule and from the nudge after a command: every call must carry a
 * valid signature for this route and body. A 500 makes QStash retry; the rows stay pending: a
 * delivery that throws releases the run's leased rows at once, and the rows of a run that dies are
 * due again when their lease runs out.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', 503, requestId, headers);

  // Only a few ids ever come in: a larger body is refused before it is read (request-body.ts).
  const body = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (body === undefined) {
    logger.log('warn', 'outbox.publish_too_large', { requestId });
    return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    body,
  );
  if (!signed) {
    logger.log('warn', 'outbox.publish_refused', { requestId });
    return failure('unauthorized', 401, requestId, headers);
  }

  try {
    const counts = await publishOutbox();
    return Response.json(OutboxPublishResponse.parse(counts), { headers });
  } catch (error) {
    logger.log('error', 'outbox.publish_failed', { requestId, error });
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
