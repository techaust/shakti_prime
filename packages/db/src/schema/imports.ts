import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { files } from './files';

const KINDS = sql`('leads', 'accounts', 'pin_codes', 'items', 'tally_masters')`;

/**
 * A saved column mapping for one kind of file (docs/design/backend-weeks-3-5.md §8), so the next
 * file from the same source maps in one step. Kept per entity like every business row.
 */
export const importMappingTemplates = pgTable(
  'import_mapping_templates',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    mappingJson: jsonb('mapping_json').notNull(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('import_mapping_templates_kind_check', sql`${t.kind} in ${KINDS}`),
    unique('import_mapping_templates_name_unique').on(t.entityId, t.kind, t.name),
    unique('import_mapping_templates_id_entity_unique').on(t.id, t.entityId),
  ],
);

/**
 * One import of one file (IMP-01). `state` moves only through the transitions in
 * `packages/domain/src/imports/job-state.ts`; the counts are kept by the commands.
 */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    kind: text('kind').notNull(),
    fileId: uuid('file_id').notNull(),
    templateId: uuid('template_id'),
    format: text('format').notNull(),
    columnsJson: jsonb('columns_json').notNull(),
    mappingJson: jsonb('mapping_json'),
    state: text('state').notNull().default('uploaded'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    committedRows: integer('committed_rows').notNull().default(0),
    failedBatch: integer('failed_batch'),
    /**
     * Batches the commit has run, one whose every row was refused included, so each batch takes
     * the next number and `imports.job.committed` counts them right.
     */
    batchCount: integer('batch_count').notNull().default(0),
    /**
     * The companies the preview found the rows naming, the job's own included, and those through
     * which the importer saw a customer a row is linked to: a commit or a rollback is refused up
     * front in a request that does not act for all of them, and the import worker acts for
     * exactly these. Null until the rows are checked.
     */
    entityIds: smallint('entity_ids').array(),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('import_jobs_kind_check', sql`${t.kind} in ${KINDS}`),
    check(
      'import_jobs_state_check',
      sql`${t.state} in ('uploaded', 'mapped', 'previewed', 'committing', 'committed', 'rolled_back', 'failed')`,
    ),
    check('import_jobs_format_check', sql`${t.format} in ('csv', 'xlsx')`),
    check(
      'import_jobs_counts_check',
      sql`least(${t.totalRows}, ${t.validRows}, ${t.invalidRows}, ${t.skippedRows}, ${t.committedRows}) >= 0
          and ${t.validRows} + ${t.invalidRows} + ${t.skippedRows} <= ${t.totalRows}
          and ${t.committedRows} <= ${t.validRows}`,
    ),
    check('import_jobs_failed_batch_check', sql`${t.failedBatch} is null or ${t.failedBatch} >= 1`),
    check('import_jobs_batch_count_check', sql`${t.batchCount} >= 0`),
    check(
      'import_jobs_entity_ids_check',
      sql`${t.entityIds} is null or cardinality(${t.entityIds}) between 1 and 20`,
    ),
    // A job uses a file and a template of its own entity (docs/DATABASE.md §2).
    foreignKey({
      name: 'import_jobs_file_entity_fk',
      columns: [t.fileId, t.entityId],
      foreignColumns: [files.id, files.entityId],
    }),
    foreignKey({
      name: 'import_jobs_template_entity_fk',
      columns: [t.templateId, t.entityId],
      foreignColumns: [importMappingTemplates.id, importMappingTemplates.entityId],
    }),
    unique('import_jobs_id_entity_unique').on(t.id, t.entityId),
    index('import_jobs_entity_created_idx').on(t.entityId, t.createdAt.desc()),
    // One uploaded file starts one job.
    unique('import_jobs_file_unique').on(t.fileId),
    index('import_jobs_template_idx').on(t.templateId),
  ],
);

/**
 * One row of an imported file: what the file said, the command input it became, what is wrong
 * with it, possible duplicates, and the record it created. Visibility follows the job.
 */
export const importRows = pgTable(
  'import_rows',
  {
    jobId: uuid('job_id').notNull(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    rowNo: integer('row_no').notNull(),
    rawJson: jsonb('raw_json').notNull(),
    normalisedJson: jsonb('normalised_json'),
    errorsJson: jsonb('errors_json').notNull().default([]),
    dedupeJson: jsonb('dedupe_json'),
    state: text('state').notNull().default('pending'),
    createdType: text('created_type'),
    createdId: uuid('created_id'),
    committedBatch: integer('committed_batch'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    primaryKey({ name: 'import_rows_pkey', columns: [t.jobId, t.rowNo] }),
    foreignKey({
      name: 'import_rows_job_entity_fk',
      columns: [t.jobId, t.entityId],
      foreignColumns: [importJobs.id, importJobs.entityId],
    }),
    check(
      'import_rows_state_check',
      sql`${t.state} in ('pending', 'valid', 'invalid', 'committed', 'skipped', 'rolled_back')`,
    ),
    check(
      'import_rows_created_type_check',
      sql`${t.createdType} in ('opportunity', 'account', 'account_link', 'pin_code')`,
    ),
    check('import_rows_row_no_check', sql`${t.rowNo} >= 1`),
    check('import_rows_created_check', sql`(${t.createdType} is null) = (${t.createdId} is null)`),
    // The commit worker's claim: the next valid rows of a job in file order.
    index('import_rows_job_state_idx').on(t.jobId, t.state, t.rowNo),
    index('import_rows_created_idx').on(t.createdId),
  ],
);
