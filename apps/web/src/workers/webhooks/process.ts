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
 * - A row already processed or failed, held by another call or in its backoff answers `duplicate`.
 * - A row tried ten times is failed by the claim (`too_many_attempts`), reported with an `error`
 *   line (its id and code), and answered `failed`.
 * - A payload the contract refuses fails the row with `payload_unreadable` for good: another try
 *   reads the same bytes.
 * - With no handler registered the row is processed with the code `no_handler`.
 * - A handler may set the row aside for good with its own code (`failed`), or keep a code on a
 *   processed row.
 * - A handler's error releases the row into a backoff that grows with its tries (1, 2, 4, 8, 16,
 *   then 30 minutes) and answers `retrying`, so QStash's chain ends; the sweep sends the row again
 *   once the backoff has passed, so an outage of a few minutes uses few of the ten tries. A release
 *   that fails is thrown: the lease lapses, QStash or the sweep tries again, and after QStash's
 *   last retry its failure callback fails the row (`handler_failed`).
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
  if (!claimed.claimed) {
    if (claimed.failed === undefined) {
      return WebhookProcessResult.parse({ inboxId, outcome: 'duplicate' });
    }
    // Ten tries used: the row is on Integration Health's failed list, and the owner is told.
    logger.log('error', 'webhooks.delivery_failed', {
      requestId,
      inboxId,
      errorCode: claimed.failed,
    });
    return WebhookProcessResult.parse({ inboxId, outcome: 'failed', errorCode: claimed.failed });
  }
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
  let handled: Awaited<ReturnType<WebhookHandler<WebhookProvider>>>;
  try {
    handled = await handler(parsed.data, context(claimed, inboxId, requestId));
  } catch (error) {
    logger.log('warn', 'webhooks.handler_failed', {
      requestId,
      inboxId,
      provider: claimed.provider,
      attempts: claimed.attempts,
      error,
    });
    // A release that fails is thrown: the lease lapses within a minute and the row is tried again.
    await mark('released');
    return WebhookProcessResult.parse({ inboxId, outcome: 'retrying' });
  }
  const { entityId } = handled;
  if (handled.failed === true) {
    // Set aside for good by the handler (a form nobody has connected), never retried: Process
    // again sends it once more after the cause is fixed.
    const errorCode = handled.code ?? 'handler_failed';
    await mark('failed', errorCode, entityId);
    logger.log('info', 'webhooks.set_aside', {
      requestId,
      inboxId,
      provider: claimed.provider,
      errorCode,
    });
    return WebhookProcessResult.parse({ inboxId, outcome: 'failed', errorCode });
  }
  const { changed } = await mark('processed', handled.code ?? null, entityId);
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
