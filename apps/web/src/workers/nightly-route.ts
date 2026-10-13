import { logger } from '../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../request-body';
import { incomingRequestId } from '../request-id';
import { fromSchedule, qstashConfig, verifyQStashSignature, workerUrl } from './qstash';
import { recordJobOutcome, type ScheduledJob } from './job-streak';
import { isRetryableWait } from './retryable';
import { NO_RETRY, workerFailure } from './route-answers';

/**
 * The `POST` handler of a scheduled worker route (docs/06-api.md §3.6): the lead rescoring, the
 * duplicate search, the notification scan and the quote expiry. Only QStash calls it: the
 * schedule, and a run handing on the rest. Every call must carry a valid signature for this route
 * and body. A 500 makes QStash retry; a body that does not parse answers 400 and QStash is told
 * not to retry. A lock wait that ran out or a statement cut off answers 503, which QStash retries.
 * Each signed call that ran counts towards the job's failure streak (`recordJobOutcome`).
 */
export function nightlyWorkerRoute<B>(spec: {
  path: string;
  /** The schedule's id without its environment, for the failure streak. */
  job: ScheduledJob;
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
    if (config === undefined) return workerFailure('integration_unavailable', requestId, headers);

    const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
    if (text === undefined) {
      logger.log('warn', `${spec.logPrefix}_too_large`, { requestId });
      return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
    }
    const signed = await verifyQStashSignature(
      config,
      request.headers.get('upstash-signature'),
      text,
      workerUrl(config, spec.path),
    );
    if (!signed) {
      logger.log('warn', `${spec.logPrefix}_refused`, { requestId });
      return workerFailure('unauthorized', requestId, headers);
    }

    let body: B;
    try {
      body = spec.body.parse(JSON.parse(text));
    } catch {
      return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
    }

    const scheduled = fromSchedule(request.headers);
    try {
      const result = await spec.run(body, { budgetMs: spec.budgetMs, requestId });
      await recordJobOutcome(spec.job, 'ok', { requestId, scheduled });
      return Response.json(result, { headers });
    } catch (error) {
      if (isRetryableWait(error)) {
        logger.log('warn', `${spec.logPrefix}_busy`, { requestId });
        await recordJobOutcome(spec.job, 'failed', { requestId, scheduled });
        return workerFailure('integration_unavailable', requestId, headers);
      }
      logger.log('error', `${spec.logPrefix}_failed`, { requestId, error });
      await recordJobOutcome(spec.job, 'failed', { requestId, scheduled });
      return workerFailure('internal', requestId, headers);
    }
  };
}
