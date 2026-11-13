import { DomainError, WebhookSweepWorkerResponse } from '@shakti/contracts';
import { executeCommand, sweepWebhooks } from '@shakti/domain';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import { publishWebhookJob, qstashConfig, type QStashConfig } from '../qstash';

export interface WebhookSweepOptions {
  requestId: string;
  /** The queue; by default the environment's. */
  config?: QStashConfig;
  publish?: typeof publishWebhookJob;
}

/** The deduplication id of a row the sweep publishes again: one per attempt it is on. */
export function sweepDeduplicationId(inboxId: string, attempts: number): string {
  return `${inboxId}:s${String(attempts)}`;
}

/**
 * The minute sweep of `webhook_inbox` (docs/03-roadmap-appendix/phase2.md §5.1), as
 * `system:workers` with no company: `webhooks.inbox.sweep` removes the payloads and rows past
 * their retention (one `retention_runs` row) and answers the rows waiting unclaimed for a minute,
 * which are published to the worker again, each once per attempt it is on, so a row whose first
 * publish failed, or whose QStash chain was lost, is processed after all. A publish that fails is
 * counted and left to the next minute.
 */
export async function runWebhookSweep(
  options: WebhookSweepOptions,
): Promise<WebhookSweepWorkerResponse> {
  const { requestId } = options;
  const config = options.config ?? qstashConfig();
  if (config === undefined) {
    throw new DomainError('integration_unavailable', 'no queue for the webhook sweep');
  }
  const publish = options.publish ?? publishWebhookJob;
  const swept = await executeCommand(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId },
    sweepWebhooks,
    {},
  );
  let republished = 0;
  let notRepublished = 0;
  for (const row of swept.waiting) {
    try {
      await publish(config, row.inboxId, sweepDeduplicationId(row.inboxId, row.attempts));
      republished += 1;
    } catch (error) {
      notRepublished += 1;
      logger.log('warn', 'webhooks.sweep_publish_failed', {
        requestId,
        inboxId: row.inboxId,
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
