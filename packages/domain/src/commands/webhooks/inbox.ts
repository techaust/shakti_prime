import {
  ClaimedWebhookDto,
  WebhookProviderSchema,
  ClaimWebhookInput,
  MarkedWebhookDto,
  MarkWebhookInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

interface ClaimRow {
  provider: string;
  payload: unknown;
  attempts: number;
  lease: string;
}

/**
 * `webhooks.event.claim` (docs/03-roadmap-appendix/phase2.md §5.1): the webhook worker leases one
 * waiting `webhook_inbox` row through `app.webhook_claim()`, which checks the platform-only
 * `webhooks.process:all` itself and counts the attempt. No request role reads the table, so the
 * definer is the only way to the row; a row already processed or failed, purged or held by
 * another call answers `claimed: false`. Delivery bookkeeping, like the outbox publisher's: no
 * audit row (`auditWhen: 'changed'` with nothing named), since every delivery is a claim.
 */
export const claimWebhook = defineCommand({
  name: 'webhooks.event.claim',
  permission: 'webhooks.process',
  minScope: 'all',
  input: ClaimWebhookInput,
  output: ClaimedWebhookDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select provider, payload, attempts, lease
        from app.webhook_claim(${input.inboxId}::uuid, ${input.leaseSeconds}::integer)`)) as unknown as ClaimRow[];
    const row = rows[0];
    if (row === undefined) return { claimed: false as const };
    return {
      claimed: true as const,
      provider: WebhookProviderSchema.parse(row.provider),
      payload: row.payload,
      attempts: row.attempts,
      lease: row.lease,
    };
  },
});

/**
 * `webhooks.event.mark`: the outcome of one row through `app.webhook_mark()` (which checks
 * `webhooks.process:all`): processed (with `no_handler` when no handler took it, and the company a
 * handler named), failed with its code, or released for QStash's retry. A change only under the
 * caller's lease, or, for the failure QStash reports after its last retry, only while no call holds
 * the row; `changed: false` otherwise. No audit row, as for the claim.
 */
export const markWebhook = defineCommand({
  name: 'webhooks.event.mark',
  permission: 'webhooks.process',
  minScope: 'all',
  input: MarkWebhookInput,
  output: MarkedWebhookDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select app.webhook_mark(${input.inboxId}::uuid, ${input.lease}, ${input.outcome},
                              ${input.errorCode}, ${input.entityId}::smallint) as changed`)) as unknown as {
      changed: boolean;
    }[];
    return { changed: rows[0]?.changed === true };
  },
});
