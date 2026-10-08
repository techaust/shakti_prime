import {
  DomainError,
  hasGrant,
  KNOWLEDGE_MAX_CHUNKS,
  KNOWLEDGE_PDF_MAX_PAGES,
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
import { getStoredFile } from '../queries/files/file-queries';
import {
  extractWithModel,
  extractWorkbook,
  KNOWLEDGE_EXTRACT_DEADLINE_MS,
  KNOWLEDGE_INDEX_DEADLINE_MS,
  KnowledgeExtractError,
  needsModel,
} from './extract';
import { knowledgePassages } from './passages';

/** Passages sent to the embedding model in one call (the vendor takes many more). */
export const EMBED_BATCH = 128;
/** Less time than this left, no embedding call is started: the file is recorded timed out. */
const MIN_EMBED_MS = 5_000;

export interface IndexKnowledgeDeps {
  /** `system:workers` for the job's file company (`knowledge.index`), never a person. */
  principal: Principal;
  store: FileStore;
  provider: AiProvider;
  /** Reads a Word document's text (the web app's `mammoth`); throws when it cannot. */
  readWord: (bytes: Uint8Array) => Promise<string>;
  /**
   * Draws the pages of a PDF the file checks have masked (a PDF of pictures) as JPEG images, in
   * order; throws when it cannot (the web app's MuPDF, which only the web app holds).
   */
  pdfPages: (bytes: Uint8Array) => Promise<Uint8Array[]>;
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

/**
 * What the model is shown of a vault file: a masked photo as it is, a masked PDF as its pages drawn
 * as pictures, one each. A PDF's own bytes are never sent. Only a file the checks masked is shown:
 * anything else is refused as having failed its checks.
 */
async function asDocuments(
  file: { contentType: string; sanitising: string | undefined },
  bytes: Uint8Array,
  deps: Pick<IndexKnowledgeDeps, 'pdfPages'>,
): Promise<ModelDocument[]> {
  if (file.sanitising !== 'masked') {
    throw new KnowledgeExtractError('knowledge_file_rejected', 'the file was not masked');
  }
  if (PHOTO_TYPES.has(file.contentType)) {
    return [{ mediaType: file.contentType as ModelDocument['mediaType'], bytes }];
  }
  if (file.contentType !== 'application/pdf') {
    throw new KnowledgeExtractError('knowledge_unreadable', `the model does not read ${file.contentType}`);
  }
  let pages: Uint8Array[];
  try {
    pages = await deps.pdfPages(bytes);
  } catch (error) {
    throw new KnowledgeExtractError('knowledge_unreadable', 'the pages could not be drawn', {
      cause: error,
    });
  }
  if (pages.length === 0) {
    throw new KnowledgeExtractError('knowledge_unreadable', 'the PDF has no pages');
  }
  if (pages.length > KNOWLEDGE_PDF_MAX_PAGES) {
    throw new KnowledgeExtractError('knowledge_too_long', 'the PDF has too many pages');
  }
  return pages.map((page) => ({ mediaType: 'image/jpeg', bytes: page }));
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
 * 3. its text by type (a PDF's masked pages, drawn as pictures by `pdfPages`, and a masked photo by
 *    Claude, a workbook sheet by sheet, a Word document by `readWord`), masked whole, cut into
 *    passages and masked again passage by passage (`knowledgePassages`), then embedded as a document through the provider wrapper, the spend counted under the vault's own
 *    name for its company (or the group only, for a file of the whole group);
 * 4. `knowledge.file.record_index` replaces its passages in one transaction, or records why it
 *    could not be read. A vendor that does not answer is left to the queue's retries; a reading
 *    that runs past its deadline (under the route's limit) is recorded `knowledge_timed_out`.
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
      const documents = await asDocuments(file, bytes, deps);
      text = await extractWithModel(
        (call) => deps.provider.complete({ ...spend, purpose: 'knowledge_extract', ...call }),
        documents,
        Math.min(KNOWLEDGE_EXTRACT_DEADLINE_MS, KNOWLEDGE_INDEX_DEADLINE_MS - (Date.now() - started)),
      );
    }
    // Masked whole, cut, and masked again passage by passage (SECURITY §5, §6).
    const passages = knowledgePassages(text);
    if (passages.length === 0) return await fail('knowledge_empty');
    if (passages.length > KNOWLEDGE_MAX_CHUNKS) return await fail('knowledge_too_long');
    const vectors: number[][] = [];
    for (let i = 0; i < passages.length; i += EMBED_BATCH) {
      const batch = passages.slice(i, i + EMBED_BATCH);
      const left = KNOWLEDGE_INDEX_DEADLINE_MS - (Date.now() - started);
      if (left < MIN_EMBED_MS) return await fail('knowledge_timed_out');
      const embedded = await deps.provider.embed({
        ...spend,
        purpose: 'knowledge_embed',
        texts: batch,
        inputType: 'document',
        totalTimeoutMs: left,
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
    // The deadline stopped an embedding call: settled by the wrapper, recorded so it can be read again.
    if (
      error instanceof DomainError &&
      error.code === 'integration_unavailable' &&
      error.details?.reason === 'ai_deadline_exceeded'
    ) {
      return fail('knowledge_timed_out');
    }
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
