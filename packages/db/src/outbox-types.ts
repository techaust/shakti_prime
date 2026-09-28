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
  /**
   * Attempts made before this run. The claim has already counted this run's attempt in the
   * table, so a failure recorded as `attempts + 1` counts it once.
   */
  attempts: number;
  createdAt: Date;
}

/**
 * What one delivery attempt did to a claimed row. A failure records the attempts made, this one
 * included, and keeps a short code of what went wrong; `deadLetter` stops further attempts, and
 * otherwise the row is due again `retryInSeconds` from now (the backoff), or at once when that is
 * left out.
 */
export type OutboxUpdate =
  | { id: string; outcome: 'published' }
  | {
      id: string;
      outcome: 'failed';
      attempts: number;
      lastError: string;
      deadLetter: boolean;
      retryInSeconds?: number;
    };

/**
 * Claims up to `limit` due rows in delivery order and leases them to this run, then hands them to
 * `deliver` outside any transaction, so no row lock is held while the queue is called; the
 * outcomes are recorded afterwards in a second short transaction. Rows another run has leased
 * are skipped; a lease that has run out (the run died) makes its rows due again.
 *
 * Each lease counts as an attempt and a release gives it back, so only a run that dies before it
 * records anything leaves one used up: a due row that has already had `maxAttempts` attempts is
 * dead-lettered (`no_outcome`) instead of being claimed, and a crash loop ends like any other run
 * of failures. Answers how many rows were claimed.
 */
export type ClaimOutbox = (
  limit: number,
  deliver: (rows: readonly OutboxRow[]) => Promise<readonly OutboxUpdate[]>,
  maxAttempts: number,
) => Promise<number>;

/**
 * The two short transactions behind `ClaimOutbox`. `lease` dead-letters the due rows that have
 * had `maxAttempts` attempts, then marks up to `limit` due rows as in flight until `leaseSeconds`
 * from now with one more attempt counted, and answers them with the lease that names this run;
 * `record` applies the outcomes and releases the rows named in `release`, giving back the attempt
 * their lease counted, touching only rows that still carry that lease, and answers how many rows
 * it changed.
 */
export interface OutboxLeaseStore {
  lease(
    limit: number,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<{ lease: string; rows: OutboxRow[] }>;
  record(
    lease: string,
    updates: readonly OutboxUpdate[],
    release: readonly string[],
  ): Promise<number>;
}

/**
 * How far behind delivery is. `oldestPendingSeconds` is the age of the oldest undelivered event;
 * `oldestDueSeconds` is how long the event that has been due longest has waited since it became
 * due (created, backoff passed and no live lease), which grows only when no publisher runs.
 * `retrying` counts events waiting out their backoff, `inFlight` those leased to a run.
 */
export interface OutboxLag {
  oldestPendingSeconds: number | null;
  oldestDueSeconds: number | null;
  retrying: number;
  inFlight: number;
  deadLettered: number;
}
