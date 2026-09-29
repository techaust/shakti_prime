import { DomainError, type DeliveredEvent, type OutboxEventResult } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';
import { handlerFor, type EventHandler } from './registry';
import { systemWorkersPrincipal } from './system-principal';

/** How long a handled event's id is remembered (docs/design/backend-weeks-3-5.md §4.1). */
export const EVENT_ID_TTL_SECONDS = 7 * 24 * 60 * 60;

export const eventKey = (id: string): string => `evt:${id}`;
export const sequenceKey = (event: Pick<DeliveredEvent, 'aggregateType' | 'aggregateId'>): string =>
  `seq:${event.aggregateType}:${event.aggregateId}`;

export interface DeliverOptions {
  keyValue: KeyValue;
  requestId: string;
  now?: () => Date;
  /** The handler to run; the registry's for the event's type when left out. */
  handler?: EventHandler | undefined;
}

function storeUnavailable(message: string, cause: unknown): DomainError {
  return new DomainError('integration_unavailable', message, {}, { cause });
}

async function stored(keyValue: KeyValue, key: string): Promise<string | null> {
  try {
    return await keyValue.get(key);
  } catch (error) {
    throw storeUnavailable('the key-value store did not answer', error);
  }
}

/**
 * Delivers one outbox event to its worker, the same way whether QStash called the route or the
 * local publisher called it in process (docs/design/phase1.md §5.2):
 *
 * 1. an id already handled (`evt:{id}`, kept seven days) answers `duplicate` and runs nothing;
 * 2. an event no newer than the newest one handled for its aggregate
 *    (`seq:{aggregateType}:{aggregateId}`) answers `duplicate` too, since QStash does not keep
 *    order between messages;
 * 3. the handler runs as `system:workers` in the event's company;
 * 4. only after it succeeds are the id and the sequence recorded, so a failure is delivered again.
 *
 * A type with no handler is `not_found`; a handler's `DomainError` passes through with its code,
 * and anything else it throws becomes `internal`.
 */
export async function deliverEvent(
  event: DeliveredEvent,
  options: DeliverOptions,
): Promise<OutboxEventResult> {
  const handler = options.handler ?? handlerFor(event.type);
  if (handler === undefined) {
    throw new DomainError('not_found', `no worker handles ${event.type}`, { type: event.type });
  }
  const { keyValue } = options;
  if ((await stored(keyValue, eventKey(event.id))) !== null) {
    return { eventId: event.id, outcome: 'duplicate' };
  }
  const newest = await stored(keyValue, sequenceKey(event));
  if (newest !== null && /^\d{1,19}$/.test(newest) && BigInt(event.sequence) <= BigInt(newest)) {
    return { eventId: event.id, outcome: 'duplicate' };
  }
  try {
    await handler(event, {
      principal: systemWorkersPrincipal(event.entityId),
      keyValue,
      requestId: options.requestId,
      now: (options.now ?? (() => new Date()))(),
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('internal', `the worker for ${event.type} failed`, {}, { cause: error });
  }
  try {
    await keyValue.set(eventKey(event.id), '1', EVENT_ID_TTL_SECONDS);
    await keyValue.set(sequenceKey(event), event.sequence, EVENT_ID_TTL_SECONDS);
  } catch (error) {
    // The work is done but not remembered: answered as retryable, and the handler, run again,
    // must leave things as the first run did (EventHandler).
    throw storeUnavailable('the event id was not recorded', error);
  }
  return { eventId: event.id, outcome: 'done' };
}
