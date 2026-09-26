import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';

/**
 * The four selling entities (docs/DATABASE.md §6.1). `letterhead_file_id` joins when `files`
 * exists and the encrypted bank details when the field-level encryption helper exists.
 */
export const entities = pgTable(
  'entities',
  {
    id: smallint('id').primaryKey(),
    code: text('code').notNull().unique(),
    legalName: text('legal_name').notNull(),
    brandName: text('brand_name').notNull(),
    gstin: text('gstin'),
    stateCode: text('state_code').notNull(),
    upiId: text('upi_id'),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('entities_code_check', sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
    check('entities_state_code_check', sql`${t.stateCode} ~ '^[0-9]{2}$'`),
    check(
      'entities_gstin_check',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
  ],
);
