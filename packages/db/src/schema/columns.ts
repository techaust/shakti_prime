import { sql } from 'drizzle-orm';
import { timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { principals } from './principals';

/** Standard timestamps (docs/DATABASE.md §2). `updated_at` is maintained by `app.set_updated_at()`. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Actor columns. Nullable on org tables because seeded rows have no principal; business tables
 * from the CRM onward declare them `notNull()`.
 */
export const actors = {
  createdBy: uuid('created_by').references((): AnyPgColumn => principals.id),
  updatedBy: uuid('updated_by').references((): AnyPgColumn => principals.id),
};

/** Soft removal for masters (docs/DATABASE.md §2). */
export const archivable = {
  archivedAt: timestamp('archived_at', { withTimezone: true }),
};

export const nowSql = sql`now()`;
