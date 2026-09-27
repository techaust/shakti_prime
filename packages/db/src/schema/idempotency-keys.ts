import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { principals } from './principals';

/**
 * Idempotency keys (docs/design/backend-weeks-3-5.md §5, docs/API.md §1). A command run with a
 * key claims the row inside its own transaction and stores its answer there, so the row exists
 * exactly when the change committed; a repeat with the same key replays that answer. A caller
 * sees and writes only its own keys (migration 0037); pg_cron removes them after 7 days.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    key: text('key').notNull(),
    command: text('command').notNull(),
    inputHash: text('input_hash').notNull(),
    // Null only inside the claiming transaction, before the command's answer is known.
    responseJson: jsonb('response_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
  },
  (t) => [
    primaryKey({ name: 'idempotency_keys_pkey', columns: [t.principalId, t.key] }),
    check('idempotency_keys_key_length_check', sql`char_length(${t.key}) between 1 and 64`),
    check('idempotency_keys_input_hash_check', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
  ],
);
