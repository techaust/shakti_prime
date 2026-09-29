import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities';
import { principals } from './principals';

/**
 * The customer timeline (docs/DATABASE.md §6.2, CRM-04): one row for each thing a command did to a
 * customer or one of their leads. Partitioned by month on `created_at`, so the key includes it;
 * the partitions live in the `crm_partitions` schema, which no request role can use. Append-only.
 * Like `audit_logs`, the log carries no foreign key to the rows it describes; the insert policy
 * ties a row's lead to its customer and company. `payload_json` holds ids, codes, counts and short
 * labels only; a note's text lives in `body`.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').notNull(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    opportunityId: uuid('opportunity_id'),
    accountId: uuid('account_id').notNull(),
    type: text('type').notNull(),
    actorPrincipalId: uuid('actor_principal_id')
      .notNull()
      .references(() => principals.id),
    payloadJson: jsonb('payload_json').notNull().default({}),
    body: text('body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'activities_pkey', columns: [t.id, t.createdAt] }),
    check(
      'activities_type_check',
      sql`${t.type} in ('lead_created', 'stage_moved', 'assigned', 'nurtured', 'reopened', 'won', 'lost', 'task_created', 'task_done', 'note', 'customer_updated', 'site_updated', 'consent_recorded', 'consent_withdrawn', 'tagged')`,
    ),
    // Free text only in a note, and a note always has it.
    check(
      'activities_body_check',
      sql`(${t.type} <> 'note') = (${t.body} is null) and (${t.body} is null or char_length(${t.body}) between 1 and 2000)`,
    ),
    check(
      'activities_payload_check',
      sql`jsonb_typeof(${t.payloadJson}) = 'object' and octet_length(${t.payloadJson}::text) <= 2000`,
    ),
    index('activities_account_created_idx').on(
      t.accountId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('activities_opportunity_created_idx').on(
      t.opportunityId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);
