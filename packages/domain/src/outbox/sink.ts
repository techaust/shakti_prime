import { isDelivered, isSubscribed, newId, type StoredEventPayload } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';

/** One event as the runner stores it: checked against the catalogue, version added. */
export interface OutboxRecord {
  type: string;
  entityId: number;
  aggregateType: string;
  aggregateId: string;
  payload: StoredEventPayload;
}

/**
 * Writes events inside the transaction it is given, so an event commits with the change it
 * announces or not at all (ADR 0005). The runner requires one; tests pass an in-memory sink.
 */
export interface OutboxSink {
  write(tx: RequestTx, records: readonly OutboxRecord[]): Promise<void>;
}

/**
 * True for an event of a subscribed type whose payload says no worker acts on it (the catalogue's
 * `undeliveredWhen`, an import's leads): it is written as delivered, so it never waits in the
 * outbox ahead of the events that do go out.
 */
function writtenDelivered(record: OutboxRecord): boolean {
  return isSubscribed(record.type) && !isDelivered(record.type, record.payload);
}

/** The production sink: `outbox_events` through the caller's own connection and policies. */
export const databaseOutboxSink: OutboxSink = {
  async write(tx, records) {
    if (records.length === 0) return;
    // No `returning`: the application role may insert events but not read them back.
    await tx.insert(schema.outboxEvents).values(
      records.map((r) => ({
        id: newId(),
        entityId: r.entityId,
        type: r.type,
        aggregateType: r.aggregateType,
        aggregateId: r.aggregateId,
        payloadJson: r.payload,
        ...(writtenDelivered(r) ? { publishedAt: sql`now()` } : {}),
      })),
    );
  },
};

/** For pure tests: keeps what it is given. */
export function memoryOutboxSink(): OutboxSink & { records: OutboxRecord[] } {
  const records: OutboxRecord[] = [];
  return {
    records,
    write(_tx, batch) {
      records.push(...batch);
      return Promise.resolve();
    },
  };
}
