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
 * A stored file (docs/DATABASE.md §6.10): the bytes live in the file store under `bucket` and
 * `key`, this row records what they are. `purpose` (the `FILE_PURPOSES` of the contracts) decides
 * who may see the row; only imports have policies so far, gated by `imports.write` (migration
 * 0041), so a row of any other purpose stays hidden until its module arrives. Scanning and masking
 * (`scanning`, `masked`) arrive with document uploads; an import file is stored as `ready`.
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
      sql`${t.purpose} in ('job_photo', 'survey_photo', 'qc_photo', 'receipt', 'signature', 'selfie', 'customer_document', 'import')`,
    ),
    check(
      'files_status_check',
      sql`${t.status} in ('pending', 'scanning', 'masked', 'ready', 'rejected')`,
    ),
    check('files_size_check', sql`${t.size} > 0`),
    check('files_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_name_length_check', sql`char_length(${t.name}) between 1 and 200`),
    unique('files_bucket_key_unique').on(t.bucket, t.key),
    // The target of the composite keys of rows that use a file (docs/DATABASE.md §2).
    unique('files_id_entity_unique').on(t.id, t.entityId),
    index('files_entity_idx').on(t.entityId),
  ],
);
