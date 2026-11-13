import { DomainError, WebhookProcessJob } from '@shakti/contracts';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import {
  qstashConfig,
  verifyQStashSignature,
  WEBHOOK_PROCESS_PATH,
  workerUrl,
} from '../../../../../../workers/qstash';
import { isRetryableWait } from '../../../../../../workers/retryable';
import { NO_RETRY, workerFailure } from '../../../../../../workers/route-answers';
import { processWebhook } from '../../../../../../workers/webhooks/process';

export const dynamic = 'force-dynamic';
/** Seconds: a handler is a few commands; the lease is 60 seconds. */
export const maxDuration = 30;

/**
 * The webhook worker (docs/06-api.md §3.6, docs/03-roadmap-appendix/phase2.md §5.1). Only QStash
 * calls it, with a `WebhookProcessJob`: the body is refused over 4 KiB before anything else is
 * read, and the signature must be QStash's for this address and body. The row is then processed
 * as `system:workers` (`processWebhook`): processed, a repeat, or failed for good with
 * `payload_unreadable`, each answered 200. A handler's error answers a retryable 5xx (503 for a
 * lock wait that ran out); after QStash's last retry the failure callback fails the row.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return workerFailure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'webhooks.job_too_large', { requestId });
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, WEBHOOK_PROCESS_PATH),
  );
  if (!signed) {
    logger.log('warn', 'webhooks.job_refused', { requestId });
    return workerFailure('unauthorized', requestId, headers);
  }

  let job: WebhookProcessJob;
  try {
    job = WebhookProcessJob.parse(JSON.parse(text));
  } catch {
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    return Response.json(await processWebhook(job.inboxId, { requestId }), { headers });
  } catch (error) {
    const busy = isRetryableWait(error);
    const code = error instanceof DomainError && !busy ? error.code : 'internal';
    logger.log('warn', 'webhooks.job_failed', {
      requestId,
      inboxId: job.inboxId,
      errorCode: code,
      error,
    });
    return workerFailure(busy ? 'integration_unavailable' : 'internal', requestId, headers);
  }
}
