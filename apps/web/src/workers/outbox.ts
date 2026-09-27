import type { OutboxPublishResponse } from '@shakti/contracts';
import { runOutboxPublisher, type EventPublisher } from '@shakti/domain';
import { checkOutboxReady, claimOutbox } from '@shakti/db/outbox';
import { hostedRuntime } from '../auth/deps';
import { logger } from '../log';
import { nudgeViaQStash, qstashConfig, qstashEventPublisher } from './qstash';

export { checkOutboxReady };

/**
 * Used where no queue is configured (local development and CI): nothing is sent, so an event a
 * worker listens to fails and is retried until the queue exists. Events nobody listens to are
 * still marked delivered, so the outbox does not back up on a developer's machine.
 */
const noQueuePublisher: EventPublisher = {
  publish: (events) =>
    Promise.resolve(events.map((e) => ({ id: e.id, ok: false, error: 'queue_not_configured' }))),
};

/** One publisher run against QStash when configured, and its counts in the log. */
export async function publishOutbox(
  publisher: EventPublisher = defaultPublisher(),
): Promise<OutboxPublishResponse> {
  const counts = await runOutboxPublisher({ claim: claimOutbox, publisher });
  if (counts.claimed > 0) logger.log('info', 'outbox.publish', { ...counts });
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
  if (!hostedRuntime()) await publishOutbox(noQueuePublisher);
}
