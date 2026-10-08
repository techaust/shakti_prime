import { timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { principals } from './principals';

/** Standard timestamps (docs/05-database.md §2). `updated_at` is maintained by `app.set_updated_at()`. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Actor columns for org and reference tables, nullable because seeded rows have no principal.
 */
export const actors = {
  createdBy: uuid('created_by').references((): AnyPgColumn => principals.id),
  updatedBy: uuid('updated_by').references((): AnyPgColumn => principals.id),
};

/** Actor columns for business tables: every row is written by a command run as a principal. */
export const actorsRequired = {
  createdBy: uuid('created_by')
    .notNull()
    .references((): AnyPgColumn => principals.id),
  updatedBy: uuid('updated_by').references((): AnyPgColumn => principals.id),
};

/** Soft removal for masters (docs/05-database.md §2). */
export const archivable = {
  archivedAt: timestamp('archived_at', { withTimezone: true }),
};
