import type { OutboxPublishResponse } from '@shakti/contracts';
import { runOutboxPublisher, type EventPublisher } from '@shakti/domain';
import { checkOutboxReady as checkOutboxLag, claimOutbox } from '@shakti/db/outbox';
import { hostedRuntime } from '../auth/deps';
import { logger } from '../log';
import { nudgeViaQStash, qstashConfig, qstashEventPublisher } from './qstash';

/** A due event waiting longer than this means no publisher is running. */
const OUTBOX_MAX_DUE_SECONDS = 300;

/**
 * Readiness of the outbox: down only when a due event has waited more than five minutes since it
 * became due, which means the publisher is not running. Events waiting out their backoff and dead
 * letters are logged with their counts instead; a queue outage alone never marks the app unready.
 */
export function checkOutboxReady(): Promise<'ok' | 'down'> {
  return checkOutboxLag(OUTBOX_MAX_DUE_SECONDS, 3_000, (lag) => {
    if (lag.retrying === 0 && lag.deadLettered === 0) return;
    logger.log(lag.deadLettered > 0 ? 'warn' : 'info', 'outbox.backlog', {
      retrying: lag.retrying,
      deadLettered: lag.deadLettered,
      inFlight: lag.inFlight,
      oldestPendingSeconds: lag.oldestPendingSeconds,
    });
  });
}

/**
 * Used where no queue is configured (local development and CI): nothing is sent, so an event a
 * worker listens to fails and is retried, after its backoff, until the queue exists. Events
 * nobody listens to are still marked delivered, so the outbox does not back up on a developer's
 * machine.
 */
const noQueuePublisher: EventPublisher = {
  publish: (events) =>
    Promise.resolve(events.map((e) => ({ id: e.id, ok: false, error: 'queue_not_configured' }))),
};

/**
 * One publisher run against QStash when configured, and its counts in the log; the events the
 * claim dead-lettered because their runs kept dying get a warning line of their own, by id.
 */
export async function publishOutbox(
  options: { publisher?: EventPublisher; requestId?: string } = {},
): Promise<OutboxPublishResponse> {
  const { requestId } = options;
  const publisher = options.publisher ?? defaultPublisher();
  const counts = await runOutboxPublisher({ claim: claimOutbox, publisher, logger, requestId });
  if (counts.claimed > 0 || counts.deadLettered > 0) {
    logger.log('info', 'outbox.publish', { requestId, ...counts });
  }
  return counts;
}

function defaultPublisher(): EventPublisher {
  const config = qstashConfig();
  return config === undefined ? noQueuePublisher : qstashEventPublisher(config);
}

/**
 * After a command commits with events (`executeCommand`'s `onCommitted`): hosted, QStash is
 * asked to run the publisher at once; locally, with no queue, the run happens in this process.
 * The minute schedule catches anything a lost nudge leaves behind.
 */
export async function nudgeOutbox(): Promise<void> {
  const config = qstashConfig();
  if (config !== undefined) {
    await nudgeViaQStash(config);
    return;
  }
  if (!hostedRuntime()) await publishOutbox({ publisher: noQueuePublisher });
}
