import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';

/**
 * A stored file (docs/05-database.md §6.10): the bytes live in the file store under `bucket` and
 * `key`, this row records what they are. `purpose` (the `FILE_PURPOSES` of the contracts) decides
 * who may create and read the row, through `app.file_purpose_grant()`, the one place the mapping
 * lives in SQL (mirrored by `packages/domain/src/files/purposes.ts`). An upload is `pending` until
 * its bytes land, then passes the checks (`scanning`, `scanned` or `not_scanned`) before it is
 * `ready` or `rejected`; an import file is stored as `ready`.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    purpose: text('purpose').notNull(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').notNull().default('pending'),
    scanResult: jsonb('scan_result'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check(
      'files_purpose_check',
      sql`${t.purpose} in ('job_photo', 'survey_photo', 'qc_photo', 'receipt', 'signature', 'selfie', 'customer_document', 'import', 'quote_pdf', 'signed_quote', 'entity_logo', 'letterhead', 'print_proof', 'knowledge', 'consent_evidence')`,
    ),
    check(
      'files_status_check',
      sql`${t.status} in ('pending', 'scanning', 'scanned', 'not_scanned', 'masked', 'ready', 'rejected')`,
    ),
    check('files_size_check', sql`${t.size} > 0`),
    check('files_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_name_length_check', sql`char_length(${t.name}) between 1 and 200`),
    unique('files_bucket_key_unique').on(t.bucket, t.key),
    // The target of the composite keys of rows that use a file (docs/05-database.md §2).
    unique('files_id_entity_unique').on(t.id, t.entityId),
    index('files_entity_idx').on(t.entityId),
    // A company's latest file of a purpose (its logo, its letterhead).
    index('files_entity_purpose_created_idx').on(t.entityId, t.purpose, t.createdAt.desc()),
    // The sweep of abandoned uploads: the oldest of the uploads still pending.
    index('files_pending_created_idx')
      .on(t.entityId, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);
