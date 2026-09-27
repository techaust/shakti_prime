import { newId, type StoredEventPayload } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';

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
