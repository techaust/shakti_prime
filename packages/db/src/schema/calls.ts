import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { callDispositions } from './crm-config';
import { entities } from './entities';
import { opportunities } from './opportunities';
import { principals } from './principals';

/**
 * A call to a lead and its outcome (docs/design/phase1.md §7.2, docs/DATABASE.md §6.2, TEL-01), a
 * child of `opportunities`: read with the lead, logged by `calls.log` by a person whose `calls.log`
 * scope covers the lead. Append-only. `attempt_no` counts the unanswered attempts in a row the
 * call belongs to (1 for a call after an answered one), which the retry rule (CALL-3) reads.
 * `disposition_id` names the outcome row, which is archived and never deleted when the outcome
 * list changes, so a call keeps its meaning.
 */
export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    opportunityId: uuid('opportunity_id').notNull(),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => principals.id),
    direction: text('direction').notNull(),
    numberSeries: text('number_series').notNull(),
    dispositionId: uuid('disposition_id')
      .notNull()
      .references(() => callDispositions.id),
    attemptNo: smallint('attempt_no').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationS: integer('duration_s'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('calls_direction_check', sql`${t.direction} in ('outbound', 'inbound')`),
    check('calls_number_series_check', sql`${t.numberSeries} in ('manual', '140', '160', 'inbound')`),
    check('calls_attempt_no_check', sql`${t.attemptNo} between 1 and 1000`),
    check('calls_duration_check', sql`${t.durationS} is null or ${t.durationS} between 0 and 14400`),
    // The call belongs to its lead's company.
    foreignKey({
      name: 'calls_opportunity_entity_fk',
      columns: [t.opportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    // A lead's latest call (the retry rule, the queue's attempts and the first-contact limit) is
    // the first entry of this index for the lead.
    index('calls_opportunity_started_idx').on(t.opportunityId, t.startedAt.desc(), t.id.desc()),
    // A caller's calls of a day (the team lead's view).
    index('calls_caller_started_idx').on(t.callerId, t.startedAt),
    index('calls_disposition_idx').on(t.dispositionId),
  ],
);
