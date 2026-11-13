import {
  WebhookProcessResult,
  type ClaimedWebhookDto,
  type WebhookProvider,
} from '@shakti/contracts';
import { claimWebhook, executeCommand, markWebhook } from '@shakti/domain';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import { WEBHOOK_CONTRACTS } from './contracts';
import { WEBHOOK_HANDLERS, type WebhookHandler, type WebhookHandlers } from './registry';

export interface ProcessWebhookOptions {
  requestId: string;
  handlers?: WebhookHandlers;
}

type Claimed = Extract<ClaimedWebhookDto, { claimed: true }>;

/**
 * Processes one stored delivery (docs/03-roadmap-appendix/phase2.md §5.1), as `system:workers`
 * with the platform-only `webhooks.process` and no company: it leases the row for 60 seconds
 * (`webhooks.event.claim`), reads the payload with its provider's contract, runs the provider's
 * handler and marks the row (`webhooks.event.mark`).
 * - A row already processed or failed, or held by another call, answers `duplicate`.
 * - A payload the contract refuses fails the row with `payload_unreadable` for good: another try
 *   reads the same bytes.
 * - With no handler registered the row is processed with the code `no_handler`.
 * - A handler's error releases the lease and is thrown, so the caller answers a 5xx and QStash
 *   tries again; after its last retry the failure callback fails the row (`handler_failed`).
 * Logs carry ids and codes only, never the payload.
 */
export async function processWebhook(
  inboxId: string,
  options: ProcessWebhookOptions,
): Promise<WebhookProcessResult> {
  const { requestId } = options;
  const handlers = options.handlers ?? WEBHOOK_HANDLERS;
  const principal = systemWorkersPrincipal(null);
  const scope = { entityIds: [], requestId };
  const claimed = await executeCommand(principal, scope, claimWebhook, { inboxId });
  if (!claimed.claimed) return WebhookProcessResult.parse({ inboxId, outcome: 'duplicate' });
  const mark = (
    outcome: 'processed' | 'failed' | 'released',
    errorCode: string | null = null,
    entityId: number | null = null,
  ) =>
    executeCommand(principal, scope, markWebhook, {
      inboxId,
      lease: claimed.lease,
      outcome,
      errorCode,
      entityId,
    });

  const parsed = WEBHOOK_CONTRACTS[claimed.provider].safeParse(claimed.payload);
  if (!parsed.success) {
    await mark('failed', 'payload_unreadable');
    logger.log('warn', 'webhooks.payload_unreadable', {
      requestId,
      inboxId,
      provider: claimed.provider,
    });
    return WebhookProcessResult.parse({
      inboxId,
      outcome: 'failed',
      errorCode: 'payload_unreadable',
    });
  }
  const handler = handlers[claimed.provider] as WebhookHandler<WebhookProvider> | undefined;
  if (handler === undefined) {
    await mark('processed', 'no_handler');
    return WebhookProcessResult.parse({ inboxId, outcome: 'processed', handled: false });
  }
  let entityId: number | null;
  try {
    ({ entityId } = await handler(parsed.data, context(claimed, inboxId, requestId)));
  } catch (error) {
    await mark('released').catch((markError: unknown) => {
      // The lease lapses on its own within a minute; the retry claims the row then.
      logger.log('warn', 'webhooks.release_failed', { requestId, inboxId, error: markError });
    });
    throw error;
  }
  const { changed } = await mark('processed', null, entityId);
  if (!changed) {
    // The lease lapsed while the handler ran and another call took the row; the handler's records
    // are idempotent by the provider's own ids, so that call's work and this one's are the same.
    logger.log('warn', 'webhooks.lease_lapsed', { requestId, inboxId, provider: claimed.provider });
  }
  return WebhookProcessResult.parse({ inboxId, outcome: 'processed', handled: true });
}

function context(claimed: Claimed, inboxId: string, requestId: string) {
  return { inboxId, requestId, attempts: claimed.attempts };
}
