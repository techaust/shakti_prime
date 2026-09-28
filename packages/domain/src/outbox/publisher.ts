import { DeliveredEvent, isSubscribed, type OutboxPublishResponse } from '@shakti/contracts';
import type { ClaimOutbox, OutboxRow, OutboxUpdate } from '@shakti/db';
import type { EventPublisher, PublishResult } from '../ports/event-publisher';
import { outboxRetryDelaySeconds } from './backoff';

/**
 * After this many attempts an event is dead-lettered and waits for a replay. With the backoff
 * (./backoff.ts) the last attempt comes about four hours after the first. The claim counts each
 * lease as an attempt, so a run that dies before it records an outcome uses one up too, and an
 * event whose runs keep dying is dead-lettered by the claim once they are spent.
 */
export const OUTBOX_MAX_ATTEMPTS = 10;
/** Rows one run claims; one batch call to the queue carries them all. */
export const OUTBOX_BATCH_SIZE = 100;

const ERROR_MAX_LENGTH = 200;

export interface OutboxPublisherOptions {
  claim: ClaimOutbox;
  publisher: EventPublisher;
  limit?: number;
  /** The jitter's source for the backoff; tests pass a fixed one. */
  random?: () => number;
}

/**
 * One publisher run (docs/design/backend-weeks-3-5.md §4.2): claim the due events in delivery
 * order (the claim leases them to this run and commits before anything is sent), send the ones a
 * worker listens to in one batch, and hand back the outcome of each for the claim to record. A
 * failed event is due again after its backoff; an event nobody listens to yet is marked delivered
 * without being sent; a row that no longer fits the catalogue can never be delivered, so it is
 * dead-lettered at once.
 */
export async function runOutboxPublisher(
  options: OutboxPublisherOptions,
): Promise<OutboxPublishResponse> {
  const counts: OutboxPublishResponse = {
    claimed: 0,
    published: 0,
    skipped: 0,
    failed: 0,
    deadLettered: 0,
  };
  const deliver = async (rows: readonly OutboxRow[]): Promise<OutboxUpdate[]> => {
    const updates: OutboxUpdate[] = [];
    const toSend: DeliveredEvent[] = [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const fail = (row: OutboxRow, error: string, now = false) => {
      // The attempts before this run and this one, which the claim has already counted in the
      // table: recording the same number counts it once.
      const attempts = row.attempts + 1;
      const deadLetter = now || attempts >= OUTBOX_MAX_ATTEMPTS;
      const lastError = error.slice(0, ERROR_MAX_LENGTH);
      updates.push(
        deadLetter
          ? { id: row.id, outcome: 'failed', attempts, lastError, deadLetter }
          : {
              id: row.id,
              outcome: 'failed',
              attempts,
              lastError,
              deadLetter,
              retryInSeconds: outboxRetryDelaySeconds(attempts, options.random),
            },
      );
      counts.failed += 1;
      if (deadLetter) counts.deadLettered += 1;
    };

    for (const row of rows) {
      const event = DeliveredEvent.safeParse({
        id: row.id,
        sequence: row.sequence,
        type: row.type,
        entityId: row.entityId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload,
      });
      if (!event.success) {
        fail(row, 'not_in_catalogue', true);
      } else if (!isSubscribed(row.type)) {
        updates.push({ id: row.id, outcome: 'published' });
        counts.skipped += 1;
      } else {
        toSend.push(event.data);
      }
    }

    if (toSend.length > 0) {
      let results: readonly PublishResult[];
      try {
        results = await options.publisher.publish(toSend);
      } catch (e) {
        const code = e instanceof Error && e.name !== 'Error' ? e.name : 'publish_failed';
        results = toSend.map((event) => ({ id: event.id, ok: false, error: code }));
      }
      const answered = new Map(results.map((r) => [r.id, r]));
      for (const event of toSend) {
        const row = byId.get(event.id);
        if (row === undefined) continue;
        const result = answered.get(event.id);
        if (result?.ok === true) {
          updates.push({ id: row.id, outcome: 'published' });
          counts.published += 1;
        } else {
          fail(row, result === undefined ? 'no_answer' : result.error);
        }
      }
    }
    return updates;
  };
  counts.claimed = await options.claim(
    options.limit ?? OUTBOX_BATCH_SIZE,
    deliver,
    OUTBOX_MAX_ATTEMPTS,
  );
  return counts;
}
