import { ErrorEnvelope, type ErrorCode } from '@shakti/contracts';
import en from '../../messages/en.json';
import { logger } from '../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../request-body';
import { incomingRequestId } from '../request-id';
import { qstashConfig, verifyQStashSignature, workerUrl } from './qstash';
import { isRetryableWait } from './retryable';

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

/**
 * The `POST` handler of a nightly worker route (docs/API.md §3.6): the lead rescoring and the
 * duplicate search. Only QStash calls it: the schedule each night, and a run handing on the rest.
 * Every call must carry a valid signature for this route and body. A 500 makes QStash retry; a
 * body that does not parse answers 400 and QStash is told not to retry. A lock wait that ran out
 * or a statement cut off answers 503, which QStash retries.
 */
export function nightlyWorkerRoute<B>(spec: {
  path: string;
  /** The prefix of the route's log lines (`crm.rescore`). */
  logPrefix: string;
  /** The body's contract, which throws on a body that does not parse. */
  body: { parse: (value: unknown) => B };
  budgetMs: number;
  run: (body: B, options: { budgetMs: number; requestId: string }) => Promise<unknown>;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = incomingRequestId(request.headers);
    const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
    const config = qstashConfig();
    if (config === undefined) return failure('integration_unavailable', 503, requestId, headers);

    const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
    if (text === undefined) {
      logger.log('warn', `${spec.logPrefix}_too_large`, { requestId });
      return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
    }
    const signed = await verifyQStashSignature(
      config,
      request.headers.get('upstash-signature'),
      text,
      workerUrl(config, spec.path),
    );
    if (!signed) {
      logger.log('warn', `${spec.logPrefix}_refused`, { requestId });
      return failure('unauthorized', 401, requestId, headers);
    }

    let body: B;
    try {
      body = spec.body.parse(JSON.parse(text));
    } catch {
      return failure('validation_failed', 400, requestId, { ...headers, ...NO_RETRY });
    }

    try {
      const result = await spec.run(body, { budgetMs: spec.budgetMs, requestId });
      return Response.json(result, { headers });
    } catch (error) {
      if (isRetryableWait(error)) {
        logger.log('warn', `${spec.logPrefix}_busy`, { requestId });
        return failure('integration_unavailable', 503, requestId, headers);
      }
      logger.log('error', `${spec.logPrefix}_failed`, { requestId, error });
      return failure('internal', 500, requestId, headers);
    }
  };
}
