/** One pending `outbox_events` row as the publisher claims it (docs/design/backend-weeks-3-5.md §4.2). */
export interface OutboxRow {
  id: string;
  /** Text form of the bigint identity: the delivery order. */
  sequence: string;
  entityId: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

/**
 * What one delivery attempt did to a claimed row. A failure counts one more attempt and keeps a
 * short code of what went wrong; `deadLetter` stops further attempts.
 */
export type OutboxUpdate =
  | { id: string; outcome: 'published' }
  | { id: string; outcome: 'failed'; attempts: number; lastError: string; deadLetter: boolean };

/**
 * Claims up to `limit` pending rows in delivery order, hands them to `deliver` while they are
 * locked, then applies its updates in the same transaction. Rows another run holds are skipped.
 */
export type ClaimOutbox = (
  limit: number,
  deliver: (rows: readonly OutboxRow[]) => Promise<readonly OutboxUpdate[]>,
) => Promise<number>;

/** How far behind delivery is: the oldest pending event's age and the dead-letter count. */
export interface OutboxLag {
  oldestPendingSeconds: number | null;
  deadLettered: number;
}
