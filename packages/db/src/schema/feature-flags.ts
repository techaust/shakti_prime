import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { actors, timestamps } from './columns';
import { entities } from './entities';

/**
 * Feature flags (docs/03-roadmap-appendix/phase4.md §6.4, docs/04-architecture.md): a key on or
 * off for the group (`entity_id` null) or for one company, whose row wins for that company. Read
 * by every request with a person or agent behind it, written only with `admin.flags.write`
 * (`admin.flag.set`); a row is switched, never deleted, so its history stays in the audit trail.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull(),
    entityId: smallint('entity_id').references(() => entities.id),
    enabled: boolean('enabled').notNull(),
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('feature_flags_key_entity_unique').on(t.key, t.entityId).nullsNotDistinct(),
    index('feature_flags_entity_idx').on(t.entityId),
    check('feature_flags_key_check', sql`${t.key} ~ '^[a-z][a-z0-9_.]{1,63}$'`),
  ],
);
