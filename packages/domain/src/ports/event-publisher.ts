import type { DeliveredEvent } from '@shakti/contracts';

/** What the queue answered for one event: accepted, or a short code of why not. */
export type PublishResult = { id: string; ok: true } | { id: string; ok: false; error: string };

/**
 * Hands events to the queue (docs/design/backend-weeks-3-5.md §4.2). QStash implements it in
 * apps/web; tests use the in-memory publisher. It answers per event and throws only when the
 * whole call failed, which the publisher counts as a failure of every event in it.
 */
export interface EventPublisher {
  publish(events: readonly DeliveredEvent[]): Promise<readonly PublishResult[]>;
}

/** For tests: keeps what it is sent; `fail` names the events it refuses and why. */
export function memoryEventPublisher(
  fail: (event: DeliveredEvent) => string | undefined = () => undefined,
): EventPublisher & { sent: DeliveredEvent[] } {
  const sent: DeliveredEvent[] = [];
  return {
    sent,
    publish(events) {
      return Promise.resolve(
        events.map((event): PublishResult => {
          const error = fail(event);
          if (error !== undefined) return { id: event.id, ok: false, error };
          sent.push(event);
          return { id: event.id, ok: true };
        }),
      );
    },
  };
}
