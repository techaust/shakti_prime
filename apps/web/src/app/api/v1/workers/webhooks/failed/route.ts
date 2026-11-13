import { OutboxFailureCallback, WebhookFailureResult } from '@shakti/contracts';
import { executeCommand, markWebhook } from '@shakti/domain';
import { logger } from '../../../../../../log';
import { readTextWithin } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { systemWorkersPrincipal } from '../../../../../../workers/events/system-principal';
import { FAILURE_BODY_MAX_BYTES } from '../../../../../../workers/outbox-failures';
import {
  qstashConfig,
  verifyQStashSignature,
  WEBHOOK_FAILED_PATH,
  workerUrl,
} from '../../../../../../workers/qstash';
import { NO_RETRY, workerFailure } from '../../../../../../workers/route-answers';
import { failedInboxId } from '../../../../../../workers/webhooks/failure';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * QStash's failure callback for the webhook worker (docs/06-api.md §3.6,
 * docs/03-roadmap-appendix/phase2.md §5.1): a job the worker still failed after the last retry
 * comes back here. The body is refused over 64 KiB before it is read and the signature must name
 * this address. The row is failed with `handler_failed` unless a live lease holds it or it was
 * processed or failed already (`unchanged`: the sweep takes up a row left waiting), and the
 * failure goes to Sentry as an error line with the row's id, the worker's status and the code,
 * never the payload. A failure here answers 500, and QStash calls again.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return workerFailure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, FAILURE_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'webhooks.failure_too_large', { requestId });
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, WEBHOOK_FAILED_PATH),
  );
  if (!signed) {
    logger.log('warn', 'webhooks.failure_refused', { requestId });
    return workerFailure('unauthorized', requestId, headers);
  }

  let callback: OutboxFailureCallback;
  try {
    callback = OutboxFailureCallback.parse(JSON.parse(text));
  } catch {
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const inboxId = failedInboxId(callback);
  if (inboxId === undefined) {
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    const { changed } = await executeCommand(
      systemWorkersPrincipal(null),
      { entityIds: [], requestId },
      markWebhook,
      { inboxId, lease: null, outcome: 'failed', errorCode: 'handler_failed' },
    );
    if (changed) {
      logger.log('error', 'webhooks.delivery_failed', {
        requestId,
        inboxId,
        status: callback.status,
        errorCode: 'handler_failed',
      });
    }
    return Response.json(
      WebhookFailureResult.parse({ inboxId, outcome: changed ? 'failed' : 'unchanged' }),
      { headers },
    );
  } catch (error) {
    logger.log('error', 'webhooks.failure_not_recorded', { requestId, inboxId, error });
    return workerFailure('internal', requestId, headers);
  }
}
