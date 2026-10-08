import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Anyone who can act: a user, an agent service principal, a voice session or the system principal
 * the event workers act as (docs/05-database.md §6.1).
 */
export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    displayName: text('display_name').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references((): AnyPgColumn => principals.id),
    updatedBy: uuid('updated_by').references((): AnyPgColumn => principals.id),
  },
  (t) => [
    check('principals_kind_check', sql`${t.kind} in ('user', 'agent', 'voice_session', 'system')`),
  ],
);
