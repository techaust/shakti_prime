import {
  DomainError,
  EmbeddingsIndexJob,
  EmbeddingsIndexResult,
  type ErrorCode,
} from '@shakti/contracts';
import { indexKnowledgeFile, type IndexKnowledgeOutcome } from '@shakti/domain';
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
import { NO_RETRY, workerFailure } from '../../../../../../workers/route-answers';

export const dynamic = 'force-dynamic';
/**
 * Seconds. Copying a PDF's text out may take the model a minute or more; the job gives the model
 * `KNOWLEDGE_EXTRACT_DEADLINE_MS` (170 seconds) in all and itself `KNOWLEDGE_INDEX_DEADLINE_MS`
 * (270), then records the file `knowledge_timed_out` rather than run into this limit. A workbook
 * or a Word document takes a few seconds.
 */
export const maxDuration = 300;

/** Refusals another delivery cannot change; every other failure is delivered again. */
const FINAL: ReadonlySet<ErrorCode> = new Set(['validation_failed', 'forbidden', 'not_found']);

/**
 * The Knowledge Vault's index worker (docs/03-roadmap-appendix/phase1.md §8.4, docs/06-api.md §3.6). Only QStash
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
  if (config === undefined) return workerFailure('integration_unavailable', requestId, headers);

  const text = await readTextWithin(request, WORKER_BODY_MAX_BYTES);
  if (text === undefined) {
    logger.log('warn', 'knowledge.job_too_large', { requestId });
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
  }
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    text,
    workerUrl(config, EMBEDDINGS_INDEX_PATH),
  );
  if (!signed) {
    logger.log('warn', 'knowledge.job_refused', { requestId });
    return workerFailure('unauthorized', requestId, headers);
  }

  let job: EmbeddingsIndexJob;
  try {
    job = EmbeddingsIndexJob.parse(JSON.parse(text));
  } catch {
    return workerFailure('validation_failed', requestId, { ...headers, ...NO_RETRY });
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
    return workerFailure(code, requestId, retried ? headers : { ...headers, ...NO_RETRY });
  }
}
