// The webhook routes' connection: the non-superuser `webhook_receiver`, which may execute
// `app.webhook_receive()` and nothing else (docs/03-roadmap-appendix/phase2.md §5.1, migration
// `webhook_inbox_rls`). The routes in apps/web/src/app/api/v1/webhooks, through
// apps/web/src/webhooks, are its only callers; importing it anywhere else is a lint error.
import postgres from 'postgres';
import { connectionOptions } from './connection';
import { optionalEnv, requireEnv } from './env';

let pool: ReturnType<typeof postgres> | undefined;

/** Whether the receiver's connection is configured; without it the routes take nothing. */
export function webhookReceiverConfigured(): boolean {
  return optionalEnv('DATABASE_URL_WEBHOOKS') !== undefined;
}

/** Opened on first use, so importing this module reads no secret (`next build` loads routes). */
function receiverSql(): ReturnType<typeof postgres> {
  const url = requireEnv('DATABASE_URL_WEBHOOKS');
  // A small pool of its own: a burst of deliveries waits here, never on the app's pool.
  pool ??= postgres(url, {
    ...connectionOptions(url, 'shakti-webhooks'),
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 2,
  });
  return pool;
}

export interface StoredDelivery {
  /** The `webhook_inbox` row, new or the one an earlier delivery of the same event made. */
  inboxId: string;
  /** True when the provider event was already stored: nothing changed. */
  repeated: boolean;
}

/**
 * Stores one delivery that passed its provider's check, once: a repeat of the same provider event
 * answers the stored row. `payload` is the delivery as JSON, `sha256` the hex checksum of its raw
 * bytes. Throws when the database refuses or does not answer within the role's 2-second limit.
 */
export async function storeWebhookDelivery(
  provider: string,
  providerEventId: string,
  payload: unknown,
  sha256: string,
): Promise<StoredDelivery> {
  const [row] = await receiverSql()<{ inbox_id: string; repeated: boolean }[]>`
    select inbox_id, repeated
      from app.webhook_receive(${provider}, ${providerEventId},
                               ${JSON.stringify(payload)}::text::jsonb, ${sha256})`;
  if (row === undefined) throw new Error('app.webhook_receive answered no row');
  return { inboxId: row.inbox_id, repeated: row.repeated };
}

export async function closeWebhookDb(): Promise<void> {
  if (pool) await pool.end({ timeout: 5 });
  pool = undefined;
}
