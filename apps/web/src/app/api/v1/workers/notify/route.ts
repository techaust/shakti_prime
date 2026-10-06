import {
  DomainError,
  ERROR_HTTP_STATUS,
  ErrorEnvelope,
  NotifyJob,
  NotifyResult,
  type ErrorCode,
} from '@shakti/contracts';
import en from '../../../../../../messages/en.json';
import { defaultAuthDeps } from '../../../../../auth/deps';
import { logger } from '../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../request-body';
import { incomingRequestId } from '../../../../../request-id';
import { deliverEvent } from '../../../../../workers/events/deliver';
import { handleNoticeEvent } from '../../../../../workers/notify/notify-event';
import {
  NOTIFY_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds: a notice is a few statements and one push per browser, each push at most 5 seconds. */
export const maxDuration = 30;

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

/** Refusals another delivery cannot change; every other failure is delivered again. */
const FINAL: ReadonlySet<ErrorCode> = new Set(['validation_failed', 'forbidden', 'not_found']);

/**
 * The notify worker (docs/API.md §3.6, docs/design/phase1.md §8.1). Only QStash calls it, with a
 * notifying outbox event as its `NotifyJob`: the body is refused over 4 KiB before anything else is
 * read, the signature must be QStash's for this address and body, and the event's id is claimed as
 * an event worker's is (`deliverEvent`), so an event already handled answers `duplicate`. The
 * notices are then written as `system:workers` of the event's company and pushed
 * (`handleNoticeEvent`). An event that does not notify, or whose payload is not its type's, is
 * refused for good; any other failure answers a retryable 5xx, and once QStash gives up the
 * failure callback holds the event back as a dead letter on Integration Health.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'notifications.job_too_large', { requestId });
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, NOTIFY_PATH),
  );
  if (!signed) {
    logger.log('warn', 'notifications.job_refused', { requestId });
    return failure('unauthorized', requestId, headers);
  }

  let job: NotifyJob;
  try {
    job = NotifyJob.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    let counts: Awaited<ReturnType<typeof handleNoticeEvent>> | undefined;
    const result = await deliverEvent(job, {
      keyValue: defaultAuthDeps().keyValue,
      requestId,
      worker: {
        ordering: 'every',
        handle: async (event, ctx) => {
          counts = await handleNoticeEvent(event, ctx);
        },
      },
    });
    const body =
      result.outcome === 'done' && counts !== undefined
        ? { eventId: job.id, outcome: 'done' as const, ...counts }
        : { eventId: job.id, outcome: 'duplicate' as const };
    return Response.json(NotifyResult.parse(body), { headers });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const retried = !FINAL.has(code);
    logger.log(retried ? 'warn' : 'error', 'notifications.job_failed', {
      requestId,
      eventId: job.id,
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
