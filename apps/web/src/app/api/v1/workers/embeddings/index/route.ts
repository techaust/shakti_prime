import {
  DomainError,
  ERROR_HTTP_STATUS,
  EmbeddingsIndexJob,
  EmbeddingsIndexResult,
  ErrorEnvelope,
  type ErrorCode,
} from '@shakti/contracts';
import { indexKnowledgeFile, type IndexKnowledgeOutcome } from '@shakti/domain';
import en from '../../../../../../../messages/en.json';
import { defaultAuthDeps } from '../../../../../../auth/deps';
import { logger } from '../../../../../../log';
import { readTextWithin, WORKER_BODY_MAX_BYTES } from '../../../../../../request-body';
import { incomingRequestId } from '../../../../../../request-id';
import { deliverEvent } from '../../../../../../workers/events/deliver';
import { indexDeps } from '../../../../../../workers/knowledge/index-deps';
import { indexEventOf } from '../../../../../../workers/knowledge/job';
import {
  EMBEDDINGS_INDEX_PATH,
  qstashConfig,
  verifyQStashSignature,
  workerUrl,
} from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/**
 * Seconds. Copying a PDF's text out may take the model a minute or more, and the provider
 * wrapper allows it three attempts of 90 seconds; a workbook or a Word document takes a few.
 */
export const maxDuration = 300;

/** QStash stops retrying a message whose answer carries this header. */
const NO_RETRY = { 'upstash-nonretryable-error': 'true' };

/** Refusals another delivery cannot change; every other failure is delivered again. */
const FINAL: ReadonlySet<ErrorCode> = new Set(['validation_failed', 'forbidden', 'not_found']);

/**
 * The Knowledge Vault's index worker (docs/design/phase1.md §8.4, docs/API.md §3.6). Only QStash
 * calls it, with the `EmbeddingsIndexJob` a `knowledge.file.index_requested` event is sent as: the
 * body is refused over 4 KiB before anything else is read, the signature must be QStash's for this
 * address and body, and the job's event id is claimed as an event worker's is (`deliverEvent`), so
 * a job already handled answers `duplicate`. The file is then read, cut into passages and embedded
 * as `system:workers` of the company the upload is stored in (`indexKnowledgeFile`). A vault file
 * that is not there is refused for good; any other failure answers a retryable 5xx, and once
 * QStash gives up the failure callback holds the event back as a dead letter on Integration
 * Health.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'knowledge.job_too_large', { requestId });
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, EMBEDDINGS_INDEX_PATH),
  );
  if (!signed) {
    logger.log('warn', 'knowledge.job_refused', { requestId });
    return failure('unauthorized', requestId, headers);
  }

  let job: EmbeddingsIndexJob;
  try {
    job = EmbeddingsIndexJob.parse(JSON.parse(text));
  } catch {
    return failure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }

  try {
    let indexed: IndexKnowledgeOutcome | undefined;
    const result = await deliverEvent(indexEventOf(job), {
      keyValue: defaultAuthDeps().keyValue,
      requestId,
      worker: {
        ordering: 'every',
        handle: async (_event, ctx) => {
          indexed = await indexKnowledgeFile(job, indexDeps(ctx.principal, requestId));
        },
      },
    });
    const body =
      result.outcome === 'done' && indexed !== undefined
        ? {
            eventId: job.eventId,
            outcome: 'done' as const,
            knowledgeFileId: indexed.knowledgeFileId,
            chunks: indexed.chunks,
            replaced: indexed.replaced,
          }
        : { eventId: job.eventId, outcome: 'duplicate' as const };
    return Response.json(EmbeddingsIndexResult.parse(body), { headers });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const retried = !FINAL.has(code);
    logger.log(retried ? 'warn' : 'error', 'knowledge.job_failed', {
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
