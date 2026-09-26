import { sql } from 'drizzle-orm';
import { check, integer, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';

/**
 * Gapless numbering per entity, document type and financial year (ADR 0006). Rows are written
 * only by `app.next_document_no()`; the application role can read them.
 */
export const documentSequences = pgTable(
  'document_sequences',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    docType: text('doc_type').notNull(),
    fy: text('fy').notNull(),
    prefix: text('prefix').notNull(),
    nextNo: integer('next_no').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique('document_sequences_series_unique').on(t.entityId, t.docType, t.fy),
    check(
      'document_sequences_doc_type_check',
      sql`${t.docType} in ('quote', 'sales_order', 'proforma', 'challan', 'purchase_order')`,
    ),
    check('document_sequences_fy_check', sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);
