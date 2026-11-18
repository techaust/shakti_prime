import type { Principal, ReplayedWebhookDto } from '@shakti/contracts';
import { executeCommand, replayWebhook, type ExecuteOptions } from '@shakti/domain';
import { after } from 'next/server';
import { logger } from '../log';
import { publishWebhookJob, qstashConfig, type QStashConfig } from '../workers/qstash';
import { processWebhook } from '../workers/webhooks/process';

export interface ReplayDeps {
  qstash: () => QStashConfig | undefined;
  publish: typeof publishWebhookJob;
  later: (task: () => Promise<unknown>) => void;
  process: typeof processWebhook;
}

function afterTheAnswer(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

const DEFAULTS: ReplayDeps = {
  qstash: () => qstashConfig(),
  publish: publishWebhookJob,
  later: afterTheAnswer,
  process: processWebhook,
};

/**
 * The deduplication id of a row Process again publishes: the attempt it is on and the request
 * that asked, so a second Process again on a row no claim has moved since is never dropped by
 * QStash as a repeat of the first.
 */
export function replayDeduplicationId(
  inboxId: string,
  attempts: number,
  requestId: string,
): string {
  return `${inboxId}:r${String(attempts)}:${requestId}`;
}

/**
 * Process again (docs/03-roadmap-appendix/phase2.md §5.1): `webhooks.event.replay` puts a failed
 * row back to wait (audited), then it is published to the worker once more, under an id of its
 * own for the attempt it is on, or, with no queue, processed in this process after the answer. A
 * publish that fails leaves the row waiting, and the sweep publishes it within two minutes.
 */
export async function processAgain(
  principal: Principal,
  requestId: string,
  input: unknown,
  options: ExecuteOptions,
  deps: Partial<ReplayDeps> = {},
): Promise<ReplayedWebhookDto> {
  const d: ReplayDeps = { ...DEFAULTS, ...deps };
  const replayed = await executeCommand(principal, { requestId }, replayWebhook, input, options);
  const config = d.qstash();
  if (config === undefined) {
    d.later(() =>
      d.process(replayed.inboxId, { requestId }).catch((error: unknown) => {
        logger.log('error', 'webhooks.process_failed', {
          requestId,
          inboxId: replayed.inboxId,
          error,
        });
      }),
    );
  } else {
    try {
      await d.publish(
        config,
        replayed.inboxId,
        replayDeduplicationId(replayed.inboxId, replayed.attempts, requestId),
      );
    } catch (error) {
      logger.log('warn', 'webhooks.publish_failed', {
        requestId,
        inboxId: replayed.inboxId,
        error,
      });
    }
  }
  return replayed;
}
