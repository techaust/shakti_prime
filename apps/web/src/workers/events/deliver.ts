import { DomainError, type DeliveredEvent, type OutboxEventResult } from '@shakti/contracts';
import { greaterNumber, type KeyValue } from '@shakti/domain';
import { workerFor, type EventWorker } from './registry';
import { systemWorkersPrincipal } from './system-principal';

/** How long a handled event's id is remembered (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.1). */
export const EVENT_ID_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * How long one delivery holds an event's id while its worker runs. Longer than any worker may run
 * (the longest route, the vault's index job, stops after 300 seconds), so a live claim is never
 * taken over; a claim left by a process that died lapses and the event can be delivered again.
 */
export const EVENT_CLAIM_SECONDS = 6 * 60;

const DONE = 'done';
const CLAIMED = 'claimed';

export const eventKey = (id: string): string => `evt:${id}`;
export const sequenceKey = (
  event: Pick<DeliveredEvent, 'type' | 'aggregateType' | 'aggregateId'>,
): string => `seq:${event.type}:${event.aggregateType}:${event.aggregateId}`;

export interface DeliverOptions {
  keyValue: KeyValue;
  requestId: string;
  now?: () => Date;
  /** The worker to run; the registry's for the event's type when left out. */
  worker?: EventWorker | undefined;
}

function storeUnavailable(message: string, cause: unknown): DomainError {
  return new DomainError('integration_unavailable', message, {}, { cause });
}

/** A store call; a failure means the event cannot be handled safely now, so it is retried. */
async function store<T>(message: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw storeUnavailable(message, error);
  }
}

/**
 * Delivers one outbox event to its worker, the same way whether QStash called the route or the
 * local publisher called it in process (docs/03-roadmap-appendix/phase1.md §5.2):
 *
 * 1. the delivery claims the event's id (`evt:{id}`, `SET NX`, five minutes) before its worker
 *    runs. An id already handled answers `duplicate`; an id another delivery holds answers
 *    `conflict` (reason `event_in_progress`), which is retried, since that delivery may yet fail;
 * 2. a `latest-only` worker skips an event no newer than the last one it handled for the aggregate
 *    (`seq:{type}:{aggregateType}:{aggregateId}`), recorded as handled and answered `duplicate`;
 *    an `every` worker (the default) runs for every event;
 * 3. the worker runs as `system:workers` in the event's company;
 * 4. on success the id is kept as handled for seven days, and a `latest-only` worker's sequence is
 *    raised to this event's in one step (never lowered by a slower, older delivery); on failure
 *    the claim is removed, so the next delivery runs the worker again.
 *
 * A type with no worker is `not_found`; a worker's `DomainError` passes through with its code, and
 * anything else it throws becomes `internal`.
 */
export async function deliverEvent(
  event: DeliveredEvent,
  options: DeliverOptions,
): Promise<OutboxEventResult> {
  const worker = options.worker ?? workerFor(event.type);
  if (worker === undefined) {
    throw new DomainError('not_found', `no worker handles ${event.type}`, { type: event.type });
  }
  const { keyValue } = options;
  const key = eventKey(event.id);
  const claimed = await store('the event id could not be claimed', () =>
    keyValue.setIfAbsent(key, CLAIMED, EVENT_CLAIM_SECONDS),
  );
  if (!claimed) {
    const state = await store('the event id could not be read', () => keyValue.get(key));
    if (state === DONE) return { eventId: event.id, outcome: 'duplicate' };
    throw new DomainError('conflict', `event ${event.id} is being handled`, {
      reason: 'event_in_progress',
    });
  }

  const latestOnly = worker.ordering === 'latest-only';
  try {
    if (latestOnly) {
      const newest = await store('the sequence could not be read', () =>
        keyValue.get(sequenceKey(event)),
      );
      if (newest !== null && !greaterNumber(event.sequence, newest)) {
        await store('the event id was not recorded', () =>
          keyValue.set(key, DONE, EVENT_ID_TTL_SECONDS),
        );
        return { eventId: event.id, outcome: 'duplicate' };
      }
    }
    try {
      await worker.handle(event, {
        principal: systemWorkersPrincipal(event.entityId),
        keyValue,
        requestId: options.requestId,
        now: (options.now ?? (() => new Date()))(),
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'internal',
        `the worker for ${event.type} failed`,
        {},
        {
          cause: error,
        },
      );
    }
  } catch (error) {
    // Nothing is kept of a failed delivery, so QStash's retry, or the next publisher run, runs it
    // again. A claim that cannot be removed lapses after its five minutes.
    await keyValue.del(key).catch(() => undefined);
    throw error;
  }
  // The work is done. If the store fails now the answer is retryable and the worker may run a
  // second time, which every worker must allow (EventHandler).
  await store('the event id was not recorded', () => keyValue.set(key, DONE, EVENT_ID_TTL_SECONDS));
  if (latestOnly) {
    await store('the sequence was not recorded', () =>
      keyValue.raiseTo(sequenceKey(event), event.sequence, EVENT_ID_TTL_SECONDS),
    );
  }
  return { eventId: event.id, outcome: 'done' };
}
