import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  real,
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
import { principals } from './principals';

/**
 * A Knowledge Vault file (docs/05-database.md §6.9, docs/03-roadmap-appendix/phase1.md §8.4): an upload of the
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
      sql`${t.errorReason} in ('knowledge_file_rejected', 'knowledge_pdf_page_too_dense', 'knowledge_masking_unavailable', 'knowledge_unreadable', 'knowledge_empty', 'knowledge_too_long', 'knowledge_spend_cap_reached', 'knowledge_service_missing', 'knowledge_timed_out')`,
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

/**
 * A Playbook directive (docs/03-roadmap-appendix/phase2.md §5.4, BLUEPRINT §9.1, PRD AI-01): a typed
 * rule an Executive approves before it steers any agent. `entity_id` null is a directive for the
 * whole group. `audience` says who may read it: `customer` (an agent may state it to a customer)
 * and `staff` with `knowledge.vault.read.staff`, `management` with
 * `knowledge.vault.read.management`; a draft or retired directive is read only by the holders of
 * the playbook grants, so a draft never reaches an agent. `state` is the `playbook_directive`
 * machine. The conflict check records `embedding` and `checked_at` through a definer, and
 * `conflicts_with` holds the approved directives it found in conflict or overlap that nobody has
 * resolved; an edit clears all three until the check runs again.
 */
export const playbookDirectives = pgTable(
  'playbook_directives',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    type: text('type').notNull(),
    audience: text('audience').notNull(),
    title: text('title').notNull(),
    text: text('text').notNull(),
    sourceFileId: uuid('source_file_id').references(() => knowledgeFiles.id),
    sourcePosition: integer('source_position'),
    state: text('state').notNull().default('draft'),
    approvedBy: uuid('approved_by').references(() => principals.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    conflictsWith: uuid('conflicts_with').array().notNull().default(sql`'{}'::uuid[]`),
    embedding: vector('embedding', { dimensions: 1024 }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'playbook_directives_type_check',
      sql`${t.type} in ('policy', 'priority', 'target', 'sop', 'faq', 'tone')`,
    ),
    check(
      'playbook_directives_audience_check',
      sql`${t.audience} in ('customer', 'staff', 'management')`,
    ),
    check('playbook_directives_state_check', sql`${t.state} in ('draft', 'approved', 'retired')`),
    check('playbook_directives_title_check', sql`char_length(${t.title}) between 1 and 120`),
    check('playbook_directives_text_check', sql`char_length(${t.text}) between 1 and 2000`),
    check(
      'playbook_directives_source_check',
      sql`${t.sourcePosition} is null or (${t.sourceFileId} is not null and ${t.sourcePosition} >= 0)`,
    ),
    // An approved directive names who approved it and when; a draft has neither. A retired one
    // keeps the approval it had, if any.
    check(
      'playbook_directives_approval_check',
      sql`(${t.approvedBy} is null) = (${t.approvedAt} is null) and (${t.state} <> 'approved' or ${t.approvedAt} is not null) and (${t.state} <> 'draft' or ${t.approvedAt} is null)`,
    ),
    check(
      'playbook_directives_retired_check',
      sql`(${t.state} = 'retired') = (${t.retiredAt} is not null) and (${t.retiredAt} is null) = (${t.retiredReason} is null) and char_length(${t.retiredReason}) between 1 and 300`,
    ),
    // An approved directive passed the conflict check with nothing left open.
    check(
      'playbook_directives_approved_checked',
      sql`${t.state} <> 'approved' or ${t.checkedAt} is not null`,
    ),
    // The list: by state and type, newest first.
    index('playbook_directives_state_type_idx').on(
      t.state,
      t.type,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('playbook_directives_source_file_idx').on(t.sourceFileId),
    // Conflict candidates: the nearest approved directives by cosine distance (ADR 0011).
    index('playbook_directives_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/**
 * One pair the conflict check compared (docs/03-roadmap-appendix/phase2.md §5.4): a draft and an
 * approved directive of the same type whose companies overlap and whose embeddings are close,
 * with the label the model gave (null while it is still to be labelled) and its short reason. An
 * Executive resolves a `conflict` or `overlap` as not a conflict, with a note, or by retiring the
 * other directive. `entity_id` is the draft's. Written by the check's definer; a person changes
 * only the resolution.
 */
export const playbookConflictChecks = pgTable(
  'playbook_conflict_checks',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    directiveId: uuid('directive_id')
      .notNull()
      .references(() => playbookDirectives.id),
    otherId: uuid('other_id')
      .notNull()
      .references(() => playbookDirectives.id),
    distance: real('distance').notNull(),
    label: text('label'),
    reason: text('reason'),
    resolution: text('resolution'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => principals.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('playbook_conflict_checks_label_check', sql`${t.label} in ('conflict', 'overlap', 'none')`),
    check(
      'playbook_conflict_checks_resolution_check',
      sql`${t.resolution} in ('not_a_conflict', 'other_retired')`,
    ),
    check('playbook_conflict_checks_pair_check', sql`${t.directiveId} <> ${t.otherId}`),
    check('playbook_conflict_checks_distance_check', sql`${t.distance} between 0 and 2`),
    check(
      'playbook_conflict_checks_reason_check',
      sql`(${t.label} is null) = (${t.reason} is null) and char_length(${t.reason}) between 1 and 300`,
    ),
    // A resolution names who resolved it and when, and only a conflict or an overlap has one.
    check(
      'playbook_conflict_checks_resolved_check',
      sql`(${t.resolution} is null) = (${t.resolvedAt} is null) and (${t.resolvedAt} is null) = (${t.resolvedBy} is null) and (${t.resolution} is null or ${t.label} in ('conflict', 'overlap'))`,
    ),
    check(
      'playbook_conflict_checks_note_check',
      sql`${t.resolutionNote} is null or (char_length(${t.resolutionNote}) between 1 and 300 and ${t.resolution} is not null)`,
    ),
    unique('playbook_conflict_checks_pair_unique').on(t.directiveId, t.otherId),
    index('playbook_conflict_checks_other_idx').on(t.otherId),
  ],
);
