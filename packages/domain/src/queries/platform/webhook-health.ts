import {
  FAILED_WEBHOOKS_SHOWN,
  FailedWebhook,
  WebhookProviderSchema,
  type FailedWebhook as Failed,
  type WebhookProvider,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const Instant = z.string().transform((value) => new Date(value).toISOString());

/** What `app.webhook_health()` answers; its times are Postgres JSON, read back as ISO 8601. */
const Answer = z.object({
  providers: z.array(
    z.object({
      provider: WebhookProviderSchema,
      received24h: z.number(),
      processed24h: z.number(),
      failed24h: z.number(),
      waiting: z.number(),
      oldestWaitingAt: Instant.nullable(),
    }),
  ),
  failed: z.object({
    total: z.number(),
    items: z.array(
      z.object({
        inboxId: z.string(),
        provider: WebhookProviderSchema,
        errorCode: z.string(),
        attempts: z.number(),
        receivedAt: Instant,
        failedAt: Instant,
      }),
    ),
  }),
});

/** The stored part of Integration Health › Webhooks: everything but the refused counts. */
export interface StoredWebhookHealth {
  providers: {
    provider: WebhookProvider;
    received24h: number;
    processed24h: number;
    failed24h: number;
    waiting: number;
    oldestWaitingAt: string | null;
  }[];
  failed: { total: number; items: Failed[] };
}

/**
 * Integration Health › Webhooks (docs/03-roadmap-appendix/phase2.md §5.1): per provider the last
 * day's deliveries received, processed and failed, those waiting and the oldest, and the failed
 * rows newest first. No request role reads `webhook_inbox`, so this goes through the definer
 * `app.webhook_health()`, which checks `admin.integrations.write:all` itself and answers ids,
 * times, attempts and codes, never a payload. The deliveries refused at their check were never
 * stored; the web app adds their counts from the key-value store.
 */
export async function readWebhookHealth(context: RequestContext): Promise<StoredWebhookHealth> {
  const rows = (await context.tx.execute(
    sql`select app.webhook_health(${FAILED_WEBHOOKS_SHOWN}::integer) as health`,
  )) as unknown as { health: unknown }[];
  const answer = Answer.parse(rows[0]?.health);
  return {
    providers: answer.providers,
    failed: {
      total: answer.failed.total,
      items: answer.failed.items.map((item) => FailedWebhook.parse(item)),
    },
  };
}
