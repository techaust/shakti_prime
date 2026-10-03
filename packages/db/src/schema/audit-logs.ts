import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
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
 * The audit trail (docs/design/backend-weeks-3-5.md §3). Partitioned by month on `created_at`,
 * so the key includes it; the partitions live in the `audit_partitions` schema, which no request
 * role can use (migration 0033). Append-only: no role may update or delete a row.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').notNull(),
    entityId: smallint('entity_id').references(() => entities.id),
    actorPrincipalId: uuid('actor_principal_id').references(() => principals.id),
    actorKind: text('actor_kind'),
    onBehalfOfUserId: uuid('on_behalf_of_user_id').references(() => principals.id),
    command: text('command').notNull(),
    aggregateType: text('aggregate_type'),
    aggregateId: text('aggregate_id'),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    inputJson: jsonb('input_json'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    ip: inet('ip'),
    device: text('device'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'audit_logs_pkey', columns: [t.id, t.createdAt] }),
    check('audit_logs_outcome_check', sql`${t.outcome} in ('ok', 'denied', 'failed')`),
    check(
      'audit_logs_actor_kind_check',
      sql`${t.actorKind} is null or ${t.actorKind} in ('user', 'agent', 'voice_session', 'system')`,
    ),
    // Only a sign-in event may lack an actor: a failed sign-in for an unknown address has none.
    check(
      'audit_logs_actor_check',
      sql`${t.command} like 'auth.%' or (${t.actorPrincipalId} is not null and ${t.actorKind} is not null)`,
    ),
    check('audit_logs_device_length_check', sql`char_length(${t.device}) <= 256`),
    index('audit_logs_entity_created_idx').on(t.entityId, t.createdAt.desc()),
    index('audit_logs_aggregate_created_idx').on(
      t.aggregateType,
      t.aggregateId,
      t.createdAt.desc(),
    ),
    index('audit_logs_actor_created_idx').on(t.actorPrincipalId, t.createdAt.desc()),
    index('audit_logs_on_behalf_of_idx').on(t.onBehalfOfUserId),
    index('audit_logs_request_idx').on(t.requestId),
  ],
);
