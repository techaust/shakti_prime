import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { files } from './files';

/**
 * A Knowledge Vault file (docs/DATABASE.md §6.9, docs/design/phase1.md §8.4): an upload of the
 * `knowledge` purpose with its title and who may retrieve it (`sensitivity`), for its company or,
 * with `entity_id` null, for the whole group. `state` is the `knowledge_file` machine; the index
 * job records `chunks`, `indexed_at` and `error_reason` through a definer, never a request.
 */
export const knowledgeFiles = pgTable(
  'knowledge_files',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    title: text('title').notNull(),
    sensitivity: text('sensitivity').notNull(),
    sourceType: text('source_type').notNull(),
    state: text('state').notNull().default('waiting'),
    chunks: integer('chunks').notNull().default(0),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    errorReason: text('error_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'knowledge_files_sensitivity_check',
      sql`${t.sensitivity} in ('staff_ai_ok', 'management', 'exec_only')`,
    ),
    check(
      'knowledge_files_source_type_check',
      sql`${t.sourceType} in ('pdf', 'photo', 'word', 'excel')`,
    ),
    check(
      'knowledge_files_state_check',
      sql`${t.state} in ('waiting', 'indexed', 'failed', 'unavailable', 'archived')`,
    ),
    check(
      'knowledge_files_error_reason_check',
      sql`${t.errorReason} in ('knowledge_file_rejected', 'knowledge_unreadable', 'knowledge_empty', 'knowledge_too_long', 'knowledge_spend_cap_reached', 'knowledge_service_missing', 'knowledge_timed_out')`,
    ),
    check('knowledge_files_title_check', sql`char_length(${t.title}) between 1 and 200`),
    check('knowledge_files_chunks_check', sql`${t.chunks} >= 0`),
    // One vault file per upload.
    unique('knowledge_files_file_unique').on(t.fileId),
    // The vault list: newest first, in the companies of the request and the group's.
    index('knowledge_files_entity_created_idx').on(t.entityId, t.createdAt.desc(), t.id.desc()),
  ],
);

/**
 * A passage of a vault file's text and its embedding (ADR 0011: 1,024 dimensions, HNSW with
 * cosine distance). `entity_id` and `sensitivity` are copied from the file, so retrieval filters
 * on the chunk itself under row-level security. Written only by the index job, through a definer.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey(),
    knowledgeFileId: uuid('knowledge_file_id')
      .notNull()
      .references(() => knowledgeFiles.id),
    entityId: smallint('entity_id').references(() => entities.id),
    sensitivity: text('sensitivity').notNull(),
    position: integer('position').notNull(),
    chunkText: text('chunk_text').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'knowledge_chunks_sensitivity_check',
      sql`${t.sensitivity} in ('staff_ai_ok', 'management', 'exec_only')`,
    ),
    check('knowledge_chunks_position_check', sql`${t.position} >= 0`),
    check('knowledge_chunks_text_check', sql`char_length(${t.chunkText}) between 1 and 4000`),
    unique('knowledge_chunks_file_position_unique').on(t.knowledgeFileId, t.position),
    // Retrieval: nearest passages by cosine distance; the policies filter the rows the scan finds.
    index('knowledge_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);
