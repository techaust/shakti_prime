import type { DeliveredEvent } from '@shakti/contracts';

/**
 * What the queue answered for one event: accepted, or a short code of why not. `deduplicated`
 * says the queue already held a message under the same deduplication id and sent nothing now.
 */
export type PublishResult =
  { id: string; ok: true; deduplicated?: boolean } | { id: string; ok: false; error: string };

/**
 * Hands events to the queue (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2). QStash implements it in
 * apps/web; tests use the in-memory publisher. It answers per event and throws only when the
 * whole call failed, which the publisher counts as a failure of every event in it.
 *
 * `generations` names the delivery generation of an event that Send again put back in the queue
 * (its `replays`), by id; an event it does not name is in its first. The queue deduplicates each
 * generation on its own, so a replay is delivered again while a retry within one generation is not.
 */
export interface EventPublisher {
  publish(
    events: readonly DeliveredEvent[],
    generations?: ReadonlyMap<string, number>,
  ): Promise<readonly PublishResult[]>;
}

/**
 * The deduplication id of one delivery generation of an event: the event's id for the first,
 * as every event was sent before replays were counted, and `<id>:<generation>` after a replay.
 */
export function deliveryDeduplicationId(eventId: string, generation = 0): string {
  return generation === 0 ? eventId : `${eventId}:${String(generation)}`;
}

/**
 * For tests: keeps what it is sent; `fail` names the events it refuses and why. Like the queue, it
 * answers `deduplicated` for a deduplication id it has already taken, and sends nothing then.
 */
export function memoryEventPublisher(
  fail: (event: DeliveredEvent) => string | undefined = () => undefined,
): EventPublisher & { sent: DeliveredEvent[]; deduplicationIds: Set<string> } {
  const sent: DeliveredEvent[] = [];
  const deduplicationIds = new Set<string>();
  return {
    sent,
    deduplicationIds,
    publish(events, generations) {
      return Promise.resolve(
        events.map((event): PublishResult => {
          const error = fail(event);
          if (error !== undefined) return { id: event.id, ok: false, error };
          const key = deliveryDeduplicationId(event.id, generations?.get(event.id));
          if (deduplicationIds.has(key)) return { id: event.id, ok: true, deduplicated: true };
          deduplicationIds.add(key);
          sent.push(event);
          return { id: event.id, ok: true };
        }),
      );
    },
  };
}
