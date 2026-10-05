import { ErrorEnvelope, LeadRescoreWorkerBody, type ErrorCode } from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { LEAD_RESCORE_RUN_BUDGET_MS, runLeadRescore } from '../../../../../../workers/lead-rescore';
import { isRetryableWait } from '../../../../../../workers/retryable';
import {
  LEAD_RESCORE_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`LEAD_RESCORE_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The nightly lead rescoring worker (CRM-06, docs/API.md §3.6). Only QStash calls it: the
 * schedule `lead-rescore` each night, and a run handing on the rest. Every call must carry a
 * valid signature for this route and body. A 500 makes QStash retry; a body that does not parse
 * answers 400 and QStash is told not to retry. A lock wait that ran out or a statement cut off
 * answers 503, which QStash retries.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', 503, requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'crm.rescore_too_large', { requestId });
    return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, LEAD_RESCORE_PATH),
  );
  if (!signed) {
    logger.log('warn', 'crm.rescore_refused', { requestId });
    return failure('unauthorized', 401, requestId, headers);
  }

  let body: LeadRescoreWorkerBody;
  try {
    body = LeadRescoreWorkerBody.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
  }

  try {
    const result = await runLeadRescore(body, { budgetMs: LEAD_RESCORE_RUN_BUDGET_MS, requestId });
    return Response.json(result, { headers });
  } catch (error) {
    if (isRetryableWait(error)) {
      logger.log('warn', 'crm.rescore_busy', { requestId });
      return failure('integration_unavailable', 503, requestId, headers);
    }
    logger.log('error', 'crm.rescore_failed', { requestId, error });
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
