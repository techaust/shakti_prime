import {
  DomainError,
  ERROR_HTTP_STATUS,
  ErrorEnvelope,
  PdfRenderJob,
  PdfRenderResult,
  type ErrorCode,
} from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { defaultAuthDeps } from '../../../../../../auth/deps';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { deliverEvent } from '../../../../../../workers/events/deliver';
import { renderEventOf } from '../../../../../../workers/pdf/job';
import { renderDeps } from '../../../../../../workers/pdf/deps';
import { renderPdfJob, type RenderOutcome } from '../../../../../../workers/pdf/render-job';
import {
  PDF_RENDER_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/**
 * Seconds. A cold start unpacks the serverless Chromium (a few seconds) before the first document
 * (about a second a page, docs/spikes/print.md); a warm instance renders in one or two.
 */
export const maxDuration = 60;

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

/** Refusals another delivery cannot change; every other failure is delivered again. */
const FINAL: ReadonlySet<ErrorCode> = new Set(['validation_failed', 'forbidden', 'not_found']);

/**
 * The render worker (ADR 0009, docs/API.md §3.6). Only QStash calls it, with the `PdfRenderJob` a
 * `print.document.requested` event is sent as: the body is refused over 4 KiB before anything else
 * is read, the signature must be QStash's for this address and body, and the job's event id is
 * claimed as an event worker's is (`deliverEvent`), so a job already rendered answers `duplicate`.
 * The document is then loaded, printed and recorded as `system:workers` of the job's company
 * (`renderPdfJob`). A job of a type no loader prints is refused for good; any other failure
 * answers a retryable 5xx, and once QStash gives up the failure callback holds the event back as
 * a dead letter on Integration Health.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'print.job_too_large', { requestId });
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, PDF_RENDER_PATH),
  );
  if (!signed) {
    logger.log('warn', 'print.job_refused', { requestId });
    return failure('unauthorized', requestId, headers);
  }

  let job: PdfRenderJob;
  try {
    job = PdfRenderJob.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    let rendered: RenderOutcome | undefined;
    const result = await deliverEvent(renderEventOf(job), {
      keyValue: defaultAuthDeps().keyValue,
      requestId,
      worker: {
        ordering: 'every',
        handle: async (_event, ctx) => {
          rendered = await renderPdfJob(job, renderDeps(ctx.principal, requestId));
        },
      },
    });
    const body =
      result.outcome === 'done' && rendered !== undefined
        ? { eventId: job.eventId, outcome: 'done' as const, ...rendered }
        : { eventId: job.eventId, outcome: 'duplicate' as const };
    return Response.json(PdfRenderResult.parse(body), { headers });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const retried = !FINAL.has(code);
    logger.log(retried ? 'warn' : 'error', 'print.job_failed', {
      requestId,
      eventId: job.eventId,
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
