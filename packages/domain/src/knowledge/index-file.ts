import {
  DomainError,
  hasGrant,
  KNOWLEDGE_MAX_CHUNKS,
  type EmbeddingsIndexJob,
  type KnowledgeErrorReason,
  type Principal,
} from '@shakti/contracts';
import { AGENT_DEFAULTS } from '../ai/agent-defaults';
import type { AiProvider, SpendCap } from '../ai/provider';
import type { ModelDocument } from '../ai/transport';
import { executeCommand, executeQuery } from '../command/execute';
import { recordKnowledgeIndex } from '../commands/knowledge/record-index';
import { knowledgeFileForIndex } from '../commands/knowledge/shared';
import { sha256Hex, type FileStore } from '../ports/file-store';
import { jsonLogger, type Logger } from '../ports/logger';
import { maskForModel } from '../privacy/model-text';
import { getStoredFile } from '../queries/files/file-queries';
import { chunkText } from './chunk';
import { extractWithModel, extractWorkbook, KnowledgeExtractError, needsModel } from './extract';

/** Passages sent to the embedding model in one call (the vendor takes many more). */
export const EMBED_BATCH = 128;

export interface IndexKnowledgeDeps {
  /** `system:workers` for the job's file company (`knowledge.index`), never a person. */
  principal: Principal;
  store: FileStore;
  provider: AiProvider;
  /** Reads a Word document's text (the web app's `mammoth`); throws when it cannot. */
  readWord: (bytes: Uint8Array) => Promise<string>;
  requestId: string;
  hosted: boolean;
  logger?: Logger;
}

export interface IndexKnowledgeOutcome {
  knowledgeFileId: string;
  chunks: number;
  replaced: number;
}

/** The daily cap the vault's reading and embedding is held to, for the whole group. */
function indexCaps(): SpendCap[] {
  return [{ paise: AGENT_DEFAULTS.knowledge.indexDailyCapPaise, entityId: null }];
}

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function asDocument(contentType: string, bytes: Uint8Array): ModelDocument {
  if (contentType === 'application/pdf' || PHOTO_TYPES.has(contentType)) {
    return { mediaType: contentType as ModelDocument['mediaType'], bytes };
  }
  throw new KnowledgeExtractError('knowledge_unreadable', `the model does not read ${contentType}`);
}

/**
 * Reads, cuts and embeds one vault file (docs/design/phase1.md §8.4, `/api/v1/workers/embeddings/
 * index`), as `system:workers` of the company the upload is stored in:
 *
 * 1. the vault file's facts through `app.knowledge_file_for_index()`; one no longer waiting (a
 *    repeated delivery, an archive) is answered as it stands, and one whose upload has not passed
 *    its checks waits for them, which send it again;
 * 2. without the keys the file needs (Voyage always, Claude for a PDF or a photo) it is recorded
 *    `unavailable` and nothing calls out;
 * 3. its text by type (a PDF and a masked photo by Claude, a workbook sheet by sheet, a Word
 *    document by `readWord`), cut into passages (`chunkText`), each masked (`maskForModel`) and
 *    embedded as a document through the provider wrapper, the spend counted under the vault's own
 *    name for its company (or the group only, for a file of the whole group);
 * 4. `knowledge.file.record_index` replaces its passages in one transaction, or records why it
 *    could not be read. A vendor that does not answer is left to the queue's retries.
 */
export async function indexKnowledgeFile(
  job: EmbeddingsIndexJob,
  deps: IndexKnowledgeDeps,
): Promise<IndexKnowledgeOutcome> {
  const log = deps.logger ?? jsonLogger();
  const started = Date.now();
  if (!hasGrant(deps.principal.permissions, 'knowledge.index', 'entity')) {
    throw new DomainError('forbidden', 'indexing a vault file needs knowledge.index');
  }
  const scope = { entityIds: [job.fileEntityId], requestId: deps.requestId };
  const facts = await executeQuery(
    deps.principal,
    scope,
    ({ tx }) => knowledgeFileForIndex(tx, job.knowledgeFileId),
    { name: 'knowledge.index.read', pool: 'app_user' },
  );
  if (facts === undefined) {
    throw new DomainError('not_found', `vault file ${job.knowledgeFileId} is not here`, {
      reason: 'knowledge_file_missing',
    });
  }
  const unchanged = { knowledgeFileId: facts.knowledgeFileId, chunks: facts.chunks, replaced: 0 };
  if (facts.state !== 'waiting') return unchanged;
  const file = await executeQuery(
    deps.principal,
    scope,
    (ctx) => getStoredFile(ctx, facts.fileId),
    {
      name: 'knowledge.index.file',
    },
  );
  // The upload's checks have not finished: they send the file again when they pass.
  if (file?.status !== 'ready') return unchanged;

  const record = async (input: object): Promise<IndexKnowledgeOutcome> => {
    const result = await executeCommand(
      deps.principal,
      scope,
      recordKnowledgeIndex,
      { entityId: job.fileEntityId, knowledgeFileId: facts.knowledgeFileId, ...input },
      { hosted: deps.hosted },
    );
    return {
      knowledgeFileId: result.knowledgeFileId,
      chunks: result.chunks,
      replaced: result.replaced,
    };
  };
  const fail = (reason: KnowledgeErrorReason) => record({ outcome: 'failed', reason });

  const source = facts.sourceType as 'pdf' | 'photo' | 'word' | 'excel';
  if (
    !deps.provider.embeddingsAvailable ||
    (needsModel(source) && !deps.provider.claudeAvailable)
  ) {
    return record({ outcome: 'unavailable', reason: 'knowledge_service_missing' });
  }

  const bytes = await deps.store.get(file.key);
  if (bytes === undefined || sha256Hex(bytes) !== file.sha256) {
    throw new DomainError('integration_unavailable', `vault upload ${file.id} could not be read`);
  }

  const spend = {
    agent: AGENT_DEFAULTS.knowledge.indexName,
    entityId: facts.entityId,
    caps: indexCaps(),
  } as const;
  try {
    let text: string;
    if (source === 'excel') text = await extractWorkbook(bytes);
    else if (source === 'word') {
      try {
        text = await deps.readWord(bytes);
      } catch (error) {
        throw new KnowledgeExtractError('knowledge_unreadable', 'the document could not be read', {
          cause: error,
        });
      }
    } else {
      const document = asDocument(file.contentType, bytes);
      text = await extractWithModel(
        (call) => deps.provider.complete({ ...spend, purpose: 'knowledge_extract', ...call }),
        document,
      );
    }
    const passages = chunkText(text).map(maskForModel);
    if (passages.length === 0) return await fail('knowledge_empty');
    if (passages.length > KNOWLEDGE_MAX_CHUNKS) return await fail('knowledge_too_long');
    const vectors: number[][] = [];
    for (let i = 0; i < passages.length; i += EMBED_BATCH) {
      const batch = passages.slice(i, i + EMBED_BATCH);
      const embedded = await deps.provider.embed({
        ...spend,
        purpose: 'knowledge_embed',
        texts: batch,
        inputType: 'document',
      });
      vectors.push(...embedded.vectors);
    }
    const outcome = await record({
      outcome: 'indexed',
      chunks: passages.map((text, i) => ({ text, embedding: vectors[i] ?? [] })),
    });
    log.log('info', 'knowledge.indexed', {
      requestId: deps.requestId,
      eventId: job.eventId,
      knowledgeFileId: facts.knowledgeFileId,
      source,
      chunks: outcome.chunks,
      replaced: outcome.replaced,
      durationMs: Date.now() - started,
    });
    return outcome;
  } catch (error) {
    if (error instanceof KnowledgeExtractError) return fail(error.reason);
    if (
      error instanceof DomainError &&
      error.code === 'rate_limited' &&
      error.details?.reason === 'agent_spend_cap_reached'
    ) {
      return fail('knowledge_spend_cap_reached');
    }
    throw error;
  }
}
