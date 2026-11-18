import {
  ClaimedWebhookDto,
  DomainError,
  ReplayedWebhookDto,
  ReplayWebhookInput,
  SweepWebhooksInput,
  WEBHOOK_SWEEP_BATCH,
  WEBHOOK_SWEEP_IDLE_SECONDS,
  WebhookSweepDto,
  WebhookProviderSchema,
  ClaimWebhookInput,
  MarkedWebhookDto,
  MarkWebhookInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';

interface ClaimRow {
  provider: string;
  payload: unknown;
  attempts: number;
  lease: string | null;
  error_code: string | null;
}

/**
 * `webhooks.event.claim` (docs/03-roadmap-appendix/phase2.md §5.1): the webhook worker leases one
 * waiting `webhook_inbox` row through `app.webhook_claim()`, which checks the platform-only
 * `webhooks.process:all` itself and counts the attempt. No request role reads the table, so the
 * definer is the only way to the row; a row already processed or failed, purged, held by another
 * call or in its backoff answers `claimed: false`, and one tried ten times is failed by the claim
 * and answers `claimed: false` with `failed: 'too_many_attempts'`. Delivery bookkeeping, like the outbox publisher's: no
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
      select provider, payload, attempts, lease, error_code
        from app.webhook_claim(${input.inboxId}::uuid, ${input.leaseSeconds}::integer)`)) as unknown as ClaimRow[];
    const row = rows[0];
    if (row === undefined) return { claimed: false as const };
    // The claim failed the row after ten tries (`too_many_attempts`): no lease, and the worker
    // reports it.
    if (row.lease === null)
      return { claimed: false as const, failed: 'too_many_attempts' as const };
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

/**
 * `webhooks.inbox.sweep` (docs/03-roadmap-appendix/phase2.md §5.1): the minute schedule
 * `webhook-sweep-<environment>` runs it as `system:workers`. Through `app.webhook_purge()` it
 * removes the payloads of rows processed `WORKSHOP_DEFAULTS.retention.webhookPayloadDays` ago and
 * the rows that arrived `webhookRowDays` ago (question 10), which the definer records as one
 * `retention_runs` row; through `app.webhook_waiting()` it answers the rows still waiting unclaimed
 * a minute after their arrival or last lease, which the worker publishes again. Both definers
 * check `webhooks.process:all`. The run's record is `retention_runs`, not the audit trail.
 */
export const sweepWebhooks = defineCommand({
  name: 'webhooks.inbox.sweep',
  permission: 'webhooks.process',
  minScope: 'all',
  input: SweepWebhooksInput,
  output: WebhookSweepDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx) {
    const { webhookPayloadDays, webhookRowDays } = WORKSHOP_DEFAULTS.retention;
    const [purged] = (await ctx.tx.execute(sql`
      select payloads, rows_removed
        from app.webhook_purge(${webhookPayloadDays}::integer, ${webhookRowDays}::integer,
                               5000)`)) as unknown as { payloads: number; rows_removed: number }[];
    const waiting = (await ctx.tx.execute(sql`
      select inbox_id, attempts
        from app.webhook_waiting(${WEBHOOK_SWEEP_IDLE_SECONDS}::integer,
                                 ${WEBHOOK_SWEEP_BATCH}::integer)`)) as unknown as {
      inbox_id: string;
      attempts: number;
    }[];
    return {
      payloadsRemoved: purged?.payloads ?? 0,
      rowsRemoved: purged?.rows_removed ?? 0,
      waiting: waiting.map((w) => ({ inboxId: w.inbox_id, attempts: w.attempts })),
    };
  },
});

/**
 * `webhooks.event.replay` (Process again, docs/03-roadmap-appendix/phase2.md §5.1): an Executive
 * puts one failed `webhook_inbox` row back to wait, with its failure and code cleared, through
 * `app.webhook_replay()`, which checks `integrations.dlq.replay:all` itself; the caller then
 * publishes it once more. A row that has not failed, or whose payload the retention removed,
 * answers `conflict` (`webhook_not_failed`). Audited under no company, with the provider, the
 * code that was cleared and the attempts, never the payload.
 */
export const replayWebhook = defineCommand({
  name: 'webhooks.event.replay',
  permission: 'integrations.dlq.replay',
  minScope: 'all',
  // Integration Health's own permission (API §3.7), held with this one by Executives.
  alsoRequires: [{ permission: 'admin.integrations.write', minScope: 'all' }],
  peopleOnly: true,
  input: ReplayWebhookInput,
  output: ReplayedWebhookDto,
  auditFields: ['provider', 'errorCode', 'attempts', 'failed'],
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select provider, attempts, error_code
        from app.webhook_replay(${input.inboxId}::uuid)`)) as unknown as {
      provider: string;
      attempts: number;
      error_code: string | null;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('conflict', `webhook ${input.inboxId} has not failed`, {
        reason: 'webhook_not_failed',
      });
    }
    const provider = WebhookProviderSchema.parse(row.provider);
    ctx.audit({
      aggregateType: 'webhook_delivery',
      aggregateId: input.inboxId,
      entityId: null,
      before: { provider, errorCode: row.error_code, failed: true },
      after: { provider, errorCode: null, failed: false, attempts: row.attempts },
    });
    return { inboxId: input.inboxId, provider, attempts: row.attempts };
  },
});
