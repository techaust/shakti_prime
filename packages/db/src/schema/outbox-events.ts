import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities';

/**
 * The transactional outbox (ADR 0005, docs/design/backend-weeks-3-5.md §4.1). A command's events
 * are inserted in its own transaction, so an event exists exactly when its change committed.
 * `app_user` may only insert; the `outbox_publisher` role reads the rows and updates the four
 * delivery columns, and a trigger refuses any other change or a delete (migration 0035).
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    // The delivery order; identity rather than `created_at`, which one transaction shares.
    sequence: bigint('sequence', { mode: 'bigint' }).notNull().unique().generatedAlwaysAsIdentity(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    type: text('type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  },
  (t) => [
    check('outbox_events_type_check', sql`${t.type} ~ '^[a-z]+(\\.[a-z_]+)+$'`),
    check('outbox_events_attempts_check', sql`${t.attempts} >= 0`),
    check('outbox_events_last_error_length_check', sql`char_length(${t.lastError}) <= 500`),
    check('outbox_events_payload_version_check', sql`${t.payloadJson} ? 'v'`),
    // The publisher's claim: pending rows in delivery order.
    index('outbox_events_pending_idx')
      .on(t.sequence)
      .where(sql`${t.publishedAt} is null and ${t.deadLetteredAt} is null`),
  ],
);
