import {
  DomainError,
  ERROR_HTTP_STATUS,
  ErrorEnvelope,
  OutboxEventDelivery,
  OutboxEventResult,
  type ErrorCode,
} from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { defaultAuthDeps } from '../../../../../../auth/deps';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { deliverEvent } from '../../../../../../workers/events/deliver';
import { handlerFor } from '../../../../../../workers/events/registry';
import {
  eventWorkerPath,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

/** Failures worth delivering again: the store or a service was away, or the worker broke. */
const RETRIED: ReadonlySet<ErrorCode> = new Set(['integration_unavailable', 'internal']);

/**
 * One outbox event, delivered by QStash to the worker of its type (docs/API.md §3.6,
 * docs/design/phase1.md §5.2). The body is refused over 4 KiB before anything else is read, then
 * the signature is checked for this address and body, then the body must be the publisher's
 * `DeliveredEvent` of the type the address names. `deliverEvent` answers `duplicate` for an id
 * already handled or an event older than the newest one of its aggregate, and otherwise runs the
 * type's handler as `system:workers`. A handler's `integration_unavailable` or `internal` answers
 * a retryable 5xx; any other refusal answers its own status with QStash's no-retry header.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'outbox.event_too_large', { requestId });
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const { type } = await params;
  // A type is named in the address by the queue group; anything else is not signed for it.
  const path = /^[a-z]+(\.[a-z_]+)+$/.test(type) ? eventWorkerPath(type) : undefined;
  const signed =
    path !== undefined &&
    (await verifyQStashSignature(
      config,
      request.headers.get('upstash-signature'),
      text,
      workerUrl(config, path),
    ));
  if (!signed) {
    logger.log('warn', 'outbox.event_refused', { requestId });
    return failure('unauthorized', requestId, headers);
  }
  if (handlerFor(type) === undefined) {
    logger.log('warn', 'outbox.event_unhandled', { requestId, type });
    return failure('not_found', requestId, { ...headers, ...NO_RETRY });
  }

  let event: OutboxEventDelivery;
  try {
    event = OutboxEventDelivery.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  if (event.type !== type) {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    const result = await deliverEvent(event, { keyValue: defaultAuthDeps().keyValue, requestId });
    logger.log('info', 'outbox.event_delivered', {
      requestId,
      eventId: event.id,
      type,
      outcome: result.outcome,
    });
    return Response.json(OutboxEventResult.parse(result), { headers });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const retried = RETRIED.has(code);
    logger.log(retried ? 'warn' : 'error', 'outbox.event_failed', {
      requestId,
      eventId: event.id,
      type,
      errorCode: code,
      error,
    });
    return failure(code, requestId, retried ? headers : { ...headers, ...NO_RETRY });
  }
}

function failure(code: ErrorCode, requestId: string, headers: Record<string, string>): Response {
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status: ERROR_HTTP_STATUS[code], headers });
}
