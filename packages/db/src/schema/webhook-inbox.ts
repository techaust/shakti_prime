import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities';

/**
 * Every provider delivery that passed its check (docs/03-roadmap-appendix/phase2.md §5.1,
 * docs/05-database.md §5). Platform data: no company at receipt; `entity_id` is set by the worker
 * once a provider's handler names the company. The webhook routes insert through
 * `app.webhook_receive()` as the login role `webhook_receiver`, which reads nothing; the worker
 * claims, marks and purges rows as `system:workers` (`webhooks.process`) through definers;
 * Integration Health reads counts through `app.webhook_health()`. No request role selects or writes
 * the table, and a trigger keeps a row as it arrived apart from its delivery and purge columns.
 */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    // The provider's own id where one delivery carries one event, else the body's SHA-256.
    providerEventId: text('provider_event_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    // Always true: a delivery that fails its check is refused and counted, never stored.
    signatureOk: boolean('signature_ok').notNull().default(true),
    // Removed 30 days after the row was processed (`WORKSHOP_DEFAULTS.retention`).
    payloadJson: jsonb('payload_json'),
    payloadSha256: text('payload_sha256').notNull(),
    entityId: smallint('entity_id').references(() => entities.id),
    // The lease of the worker call processing the row.
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    // The attempts when Process again last put the row back: the limit of ten tries counts from it,
    // while `attempts` itself only rises, since each delivery's deduplication id names it.
    attemptsAtReplay: integer('attempts_at_replay').notNull().default(0),
    // After a handler error, when the row may be tried again: a backoff that grows with its tries.
    retryAt: timestamp('retry_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    payloadPurgedAt: timestamp('payload_purged_at', { withTimezone: true }),
  },
  (t) => [
    unique('webhook_inbox_provider_event_unique').on(t.provider, t.providerEventId),
    check(
      'webhook_inbox_provider_check',
      sql`${t.provider} in ('meta_whatsapp', 'meta_leadgen', 'google_leadform', 'exotel_status', 'exotel_incoming', 'livekit')`,
    ),
    check('webhook_inbox_event_id_check', sql`char_length(${t.providerEventId}) between 1 and 200`),
    check('webhook_inbox_signature_check', sql`${t.signatureOk}`),
    check('webhook_inbox_sha256_check', sql`${t.payloadSha256} ~ '^[0-9a-f]{64}$'`),
    check('webhook_inbox_attempts_check', sql`${t.attempts} >= 0`),
    check(
      'webhook_inbox_attempts_at_replay_check',
      sql`${t.attemptsAtReplay} between 0 and ${t.attempts}`,
    ),
    check('webhook_inbox_error_code_check', sql`${t.errorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check('webhook_inbox_outcome_check', sql`${t.processedAt} is null or ${t.failedAt} is null`),
    check(
      'webhook_inbox_purge_check',
      sql`(${t.payloadJson} is null) = (${t.payloadPurgedAt} is not null)`,
    ),
    // The sweep and the oldest waiting row: rows neither processed nor failed, by arrival.
    index('webhook_inbox_waiting_idx')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null and ${t.failedAt} is null`),
    // The failed rows on Integration Health, newest first.
    index('webhook_inbox_failed_idx')
      .on(t.failedAt.desc(), t.id.desc())
      .where(sql`${t.failedAt} is not null`),
    // The last day's processed counts per provider.
    index('webhook_inbox_provider_processed_idx')
      .on(t.provider, t.processedAt)
      .where(sql`${t.processedAt} is not null`),
    // The payload purge: processed rows that still hold their payload, so purged rows leave it.
    index('webhook_inbox_purge_idx')
      .on(t.processedAt)
      .where(sql`${t.processedAt} is not null and ${t.payloadJson} is not null`),
    // The last day's received counts per provider.
    index('webhook_inbox_provider_received_idx').on(t.provider, t.receivedAt),
    // The removal of rows 90 days after arrival, oldest first.
    index('webhook_inbox_received_idx').on(t.receivedAt),
    index('webhook_inbox_entity_idx')
      .on(t.entityId)
      .where(sql`${t.entityId} is not null`),
  ],
);
