import { DomainError, WebhookSweepWorkerResponse } from '@shakti/contracts';
import { executeCommand, sweepWebhooks } from '@shakti/domain';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import { publishWebhookJobs, qstashConfig, type QStashConfig } from '../qstash';

export interface WebhookSweepOptions {
  requestId: string;
  /** How long the run may take, from its start; the publish gets what is left, at most 10 s. */
  budgetMs?: number;
  /** The queue; by default the environment's. */
  config?: QStashConfig;
  publish?: typeof publishWebhookJobs;
  now?: () => number;
}

/** The longest the one batch call may take. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** The deduplication id of a row the sweep publishes again: one per attempt it is on. */
export function sweepDeduplicationId(inboxId: string, attempts: number): string {
  return `${inboxId}:s${String(attempts)}`;
}

/**
 * The minute sweep of `webhook_inbox` (docs/03-roadmap-appendix/phase2.md §5.1), as
 * `system:workers` with no company: `webhooks.inbox.sweep` removes the payloads and rows past
 * their retention (one `retention_runs` row) and answers the rows waiting unclaimed for a minute,
 * which are published to the worker again in one batch call, each once per attempt it is on, so a
 * row whose first publish failed, whose call died, or whose backoff after a handler error has
 * passed, is processed after all. The call gets what is left of the run's budget; what it does not
 * take is counted and left to the next minute.
 */
export async function runWebhookSweep(
  options: WebhookSweepOptions,
): Promise<WebhookSweepWorkerResponse> {
  const { requestId } = options;
  const config = options.config ?? qstashConfig();
  if (config === undefined) {
    throw new DomainError('integration_unavailable', 'no queue for the webhook sweep');
  }
  const publish = options.publish ?? publishWebhookJobs;
  const now = options.now ?? Date.now;
  const started = now();
  const swept = await executeCommand(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId },
    sweepWebhooks,
    {},
  );
  // One batch call for every waiting row, given what is left of the run's time: a slow queue costs
  // one timeout, never one per row, and what it does not take waits for the next minute.
  let republished = 0;
  let notRepublished = 0;
  const left = Math.min(
    PUBLISH_TIMEOUT_MS,
    (options.budgetMs ?? PUBLISH_TIMEOUT_MS) - (now() - started),
  );
  if (swept.waiting.length > 0 && left <= 0) {
    notRepublished = swept.waiting.length;
  } else if (swept.waiting.length > 0) {
    try {
      const taken = await publish(
        config,
        swept.waiting.map((row) => ({
          inboxId: row.inboxId,
          deduplicationId: sweepDeduplicationId(row.inboxId, row.attempts),
        })),
        left,
      );
      republished = taken.filter(Boolean).length;
      notRepublished = swept.waiting.length - republished;
    } catch (error) {
      notRepublished = swept.waiting.length;
      logger.log('warn', 'webhooks.sweep_publish_failed', {
        requestId,
        waiting: swept.waiting.length,
        error,
      });
    }
  }
  const result = WebhookSweepWorkerResponse.parse({
    payloadsRemoved: swept.payloadsRemoved,
    rowsRemoved: swept.rowsRemoved,
    republished,
    notRepublished,
  });
  logger.log('info', 'webhooks.swept', { requestId, ...result });
  return result;
}
