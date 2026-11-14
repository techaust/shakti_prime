import { DomainError, MessagingSendJob, MessagingSendResult, type ErrorCode } from '@shakti/contracts';
import { defaultAuthDeps, hostedRuntime } from '../../../../../../auth/deps';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { deliverEvent } from '../../../../../../workers/events/deliver';
import { sendEventOf } from '../../../../../../workers/messaging/job';
import { sendDeps } from '../../../../../../workers/messaging/send-deps';
import { sendQueuedMessage } from '../../../../../../workers/messaging/send';
import {
  MESSAGING_SEND_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';
import { NO_RETRY, workerFailure } from '../../../../../../workers/route-answers';

export const dynamic = 'force-dynamic';
/** Seconds: Meta answers a send within its 10-second limit. */
export const maxDuration = 30;

/** Refusals another delivery cannot change; every other failure is delivered again. */
const FINAL: ReadonlySet<ErrorCode> = new Set(['validation_failed', 'forbidden', 'not_found']);

/**
 * The messaging worker (docs/06-api.md §3.6 and §6). Only QStash calls it, with the
 * `MessagingSendJob` a `messaging.message.requested` event is sent as: the body is refused over
 * 4 KiB before anything else is read, the signature must be QStash's for this address and body, and
 * the job's event id is claimed as an event worker's is (`deliverEvent`), so a job already handled
 * answers `duplicate`. The message is then checked and sent once as `system:workers` of its
 * company (`sendQueuedMessage`). A thread over its rate limit, or WhatsApp not set up, answers a
 * retryable 5xx; once QStash gives up, the failure callback holds the event back as a dead letter.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return workerFailure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'messaging.job_too_large', { requestId });
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, MESSAGING_SEND_PATH),
  );
  if (!signed) {
    logger.log('warn', 'messaging.job_refused', { requestId });
    return workerFailure('unauthorized', requestId, headers);
  }

  let job: MessagingSendJob;
  try {
    job = MessagingSendJob.parse(JSON.parse(text));
  } catch {
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    let outcome: MessagingSendResult | undefined;
    const keyValue = defaultAuthDeps().keyValue;
    const result = await deliverEvent(sendEventOf(job), {
      keyValue,
      requestId,
      worker: {
        ordering: 'every',
        handle: async (_event, ctx) => {
          outcome = await sendQueuedMessage(
            job,
            sendDeps(ctx.principal, ctx.keyValue, requestId, hostedRuntime()),
          );
        },
      },
    });
    const body =
      result.outcome === 'done' && outcome !== undefined
        ? outcome
        : { eventId: job.eventId, outcome: 'duplicate' as const };
    return Response.json(MessagingSendResult.parse(body), { headers });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const retried = !FINAL.has(code);
    logger.log(retried ? 'warn' : 'error', 'messaging.job_failed', {
      requestId,
      eventId: job.eventId,
      errorCode: code,
      error,
    });
    return workerFailure(code, requestId, retried ? headers : { ...headers, ...NO_RETRY });
  }
}
