import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './ids';

// The Knowledge Vault (docs/design/phase1.md §8.4, BLUEPRINT §9.1, PRD AI-01): a vault file, the
// chunks its text is cut into with their embeddings, and the staff search over them. Every vault
// file is tagged with who may retrieve it; the read policies filter by it (SECURITY §11 item 6).

/** Who may retrieve a vault file and its chunks (`knowledge.vault.read.staff`, `.management`, `.exec`). */
export const KNOWLEDGE_SENSITIVITIES = ['staff_ai_ok', 'management', 'exec_only'] as const;
export const KnowledgeSensitivitySchema = z.enum(KNOWLEDGE_SENSITIVITIES);
export type KnowledgeSensitivity = z.infer<typeof KnowledgeSensitivitySchema>;

/** The permission that reads each sensitivity, at scope `all` (SECURITY §3.2). */
export const KNOWLEDGE_READ_PERMISSION = {
  staff_ai_ok: 'knowledge.vault.read.staff',
  management: 'knowledge.vault.read.management',
  exec_only: 'knowledge.vault.read.exec',
} as const satisfies Record<KnowledgeSensitivity, string>;

/** What a vault file is, which decides how its text is read (BLUEPRINT §9.1). */
export const KNOWLEDGE_SOURCE_TYPES = ['pdf', 'photo', 'word', 'excel'] as const;
export const KnowledgeSourceTypeSchema = z.enum(KNOWLEDGE_SOURCE_TYPES);
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;

/**
 * `knowledge_files.state`, the `knowledge_file` machine: waiting to be read, indexed, failed,
 * unavailable while the reading or search service has no key, or archived (out of search).
 */
export const KNOWLEDGE_FILE_STATES = [
  'waiting',
  'indexed',
  'failed',
  'unavailable',
  'archived',
] as const;
export const KnowledgeFileStateSchema = z.enum(KNOWLEDGE_FILE_STATES);
export type KnowledgeFileState = z.infer<typeof KnowledgeFileStateSchema>;

/**
 * Why a vault file is `failed` or `unavailable` (`knowledge_files.error_reason`); each is a reason
 * of the message catalogue, said in plain words on the vault screen.
 */
export const KNOWLEDGE_ERROR_REASONS = [
  // The file did not pass its checks (a threat, a scan that failed, a photo that could not be masked).
  'knowledge_file_rejected',
  // The text could not be read from the file.
  'knowledge_unreadable',
  // The file holds no text to search.
  'knowledge_empty',
  // The file is longer than one vault file may be.
  'knowledge_too_long',
  // The day's spending limit for reading vault files was reached.
  'knowledge_spend_cap_reached',
  // No key for the reading or search service is set yet (`unavailable`).
  'knowledge_service_missing',
] as const;
export const KnowledgeErrorReasonSchema = z.enum(KNOWLEDGE_ERROR_REASONS);
export type KnowledgeErrorReason = z.infer<typeof KnowledgeErrorReasonSchema>;

/** A vault file's title, as people search and list it. */
export const KnowledgeTitleSchema = z.string().trim().min(1).max(200);

/** The embedding model's size (ADR 0011, `knowledge_chunks.embedding vector(1024)`). */
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1024;

/**
 * `knowledge.file.add` (people only, `knowledge.vault.write`): a vault upload that has landed
 * (`files.upload.complete`) becomes a vault file with its title and sensitivity, for its company
 * or, with `wholeGroup`, for every company. `entityId` is the company the upload was stored in,
 * which the request acts for; a file for the whole group needs a request for every company.
 */
export const AddKnowledgeFileInput = z
  .object({
    entityId: EntityIdSchema,
    fileId: IdSchema,
    title: KnowledgeTitleSchema,
    sensitivity: KnowledgeSensitivitySchema,
    wholeGroup: z.boolean().default(false),
  })
  .strict();
export type AddKnowledgeFileInput = z.input<typeof AddKnowledgeFileInput>;

/** `knowledge.file.reindex` and `knowledge.file.archive`: one vault file the caller reads. */
export const KnowledgeFileRefInput = z
  .object({ entityId: EntityIdSchema, knowledgeFileId: IdSchema })
  .strict();
export type KnowledgeFileRefInput = z.input<typeof KnowledgeFileRefInput>;

/** One chunk the index job read and embedded, in the order it stands in the file. */
export const KnowledgeChunkInput = z
  .object({
    text: z.string().min(1).max(4000),
    embedding: z.array(z.number()).length(KNOWLEDGE_EMBEDDING_DIMENSIONS),
  })
  .strict();
export type KnowledgeChunkInput = z.infer<typeof KnowledgeChunkInput>;

/** The most chunks one vault file may have; a longer file is `knowledge_too_long`. */
export const KNOWLEDGE_MAX_CHUNKS = 400;

/**
 * `knowledge.file.record_index` (the index job, `knowledge.index`): what reading the file came to.
 * `indexed` with its chunks, which replace the file's earlier ones; `failed` or `unavailable` with
 * the reason. `entityId` is the company the file is stored in, where the job acts.
 */
export const RecordKnowledgeIndexInput = z.discriminatedUnion('outcome', [
  z
    .object({
      entityId: EntityIdSchema,
      knowledgeFileId: IdSchema,
      outcome: z.literal('indexed'),
      chunks: z.array(KnowledgeChunkInput).min(1).max(KNOWLEDGE_MAX_CHUNKS),
    })
    .strict(),
  z
    .object({
      entityId: EntityIdSchema,
      knowledgeFileId: IdSchema,
      outcome: z.enum(['failed', 'unavailable']),
      reason: KnowledgeErrorReasonSchema,
    })
    .strict(),
]);
export type RecordKnowledgeIndexInput = z.input<typeof RecordKnowledgeIndexInput>;

/**
 * What the index job recorded: `skipped` when the file was no longer waiting (archived or indexed
 * meanwhile, or a repeated delivery), with nothing changed.
 */
export const KnowledgeIndexRecordDto = z
  .object({
    knowledgeFileId: IdSchema,
    state: KnowledgeFileStateSchema,
    chunks: z.number().int().min(0),
    replaced: z.number().int().min(0),
    skipped: z.boolean(),
  })
  .strict();
export type KnowledgeIndexRecordDto = z.infer<typeof KnowledgeIndexRecordDto>;

/** A vault file as the vault screen lists it. */
export const KnowledgeFileDto = z
  .object({
    id: IdSchema,
    /** Null for a file of the whole group. */
    entityId: EntityIdSchema.nullable(),
    fileId: IdSchema,
    title: KnowledgeTitleSchema,
    sensitivity: KnowledgeSensitivitySchema,
    sourceType: KnowledgeSourceTypeSchema,
    state: KnowledgeFileStateSchema,
    chunks: z.number().int().min(0),
    indexedAt: z.iso.datetime().nullable(),
    errorReason: KnowledgeErrorReasonSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type KnowledgeFileDto = z.infer<typeof KnowledgeFileDto>;

/** A page of the vault's files, newest first; `nextCursor` reads the next page. */
export const KnowledgeFilePageDto = z
  .object({ files: z.array(KnowledgeFileDto), nextCursor: z.string().nullable() })
  .strict();
export type KnowledgeFilePageDto = z.infer<typeof KnowledgeFilePageDto>;

/** The vault list's page: from the start, or after the cursor of the page before. */
export const ListKnowledgeFilesInput = z
  .object({ cursor: z.string().max(200).nullable().default(null) })
  .strict();
export type ListKnowledgeFilesInput = z.input<typeof ListKnowledgeFilesInput>;

/** The staff search: a question in the reader's own words. */
export const SearchKnowledgeInput = z.object({ query: z.string().trim().min(2).max(500) }).strict();
export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInput>;

/** The most passages one search answers. */
export const KNOWLEDGE_SEARCH_LIMIT = 8;

/** One passage the search found, with the file it comes from; `distance` is cosine, 0 the closest. */
export const KnowledgeHitDto = z
  .object({
    knowledgeFileId: IdSchema,
    title: KnowledgeTitleSchema,
    position: z.number().int().min(0),
    text: z.string(),
    distance: z.number().min(0).max(2),
  })
  .strict();
export type KnowledgeHitDto = z.infer<typeof KnowledgeHitDto>;

/** The search's answer; `available` is false while the search service has no key. */
export const KnowledgeSearchDto = z
  .object({ available: z.boolean(), hits: z.array(KnowledgeHitDto) })
  .strict();
export type KnowledgeSearchDto = z.infer<typeof KnowledgeSearchDto>;
