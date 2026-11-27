/**
 * The connector's named settings (docs/03-roadmap-appendix/phase5.md §6.2, ADR 0013). Tally serves
 * Accounts on the same PC, so every read is small, one at a time, with a pause between; the BOS
 * calls retry briefly and otherwise wait for the next cycle. Tests pass smaller values.
 */
export interface Settings {
  /**
   * The smallest window of AlterIDs a page reads, where every read starts: a page holds at most
   * this many vouchers and ledgers, well inside a batch's limits.
   */
  pageSize: number;
  /** The widest window a page grows to, so a stretch of other changes costs Tally fewer reads. */
  pageSizeMax: number;
  /** A page with fewer rows than this doubles the next window, up to `pageSizeMax`. */
  pageGrowBelowRows: number;
  /** A page with more rows than this halves the next window, down to `pageSize`. */
  pageShrinkAboveRows: number;
  /** AlterIDs per page of the daily GUID snapshot, which reads three short fields only. */
  snapshotPageSize: number;
  /** The pause between two requests to Tally, whatever the company. */
  tallyPauseMs: number;
  /** How long one page may take before the request is given up. */
  tallyTimeoutMs: number;
  /** Retries of a page that failed or timed out, each after a longer wait. */
  tallyRetries: number;
  /** The first wait before a retry to Tally; doubled on each retry. */
  tallyBackoffMs: number;
  bosTimeoutMs: number;
  bosRetries: number;
  bosBackoffMs: number;
  /** The longest `Retry-After` the connector honours before it waits for the next cycle instead. */
  bosMaxRetryAfterMs: number;
  heartbeatEveryMs: number;
  /** Each company is read this often while the BOS answers. */
  readEveryMs: number;
  /** The daily GUID snapshot, in India time. */
  snapshotAtIst: { hour: number; minute: number };
  /** Sent batches stay in the outbox this long, matching the BOS's idempotency keys. */
  outboxKeepDays: number;
  /**
   * Sends of one outbox row that the BOS answered without taking it (a refusal, or an answer the
   * connector cannot read) before the row is set aside, logged and counted in the heartbeat. A
   * send the BOS never answered does not count, so an outage sets nothing aside.
   */
  outboxMaxAttempts: number;
  logKeepDays: number;
}

export const SETTINGS: Settings = {
  pageSize: 200,
  pageSizeMax: 10_000,
  pageGrowBelowRows: 50,
  pageShrinkAboveRows: 400,
  snapshotPageSize: 5_000,
  tallyPauseMs: 1_000,
  tallyTimeoutMs: 60_000,
  tallyRetries: 3,
  tallyBackoffMs: 2_000,
  bosTimeoutMs: 30_000,
  bosRetries: 2,
  bosBackoffMs: 1_000,
  bosMaxRetryAfterMs: 60_000,
  heartbeatEveryMs: 5 * 60_000,
  readEveryMs: 2 * 60_000,
  snapshotAtIst: { hour: 2, minute: 0 },
  outboxKeepDays: 7,
  outboxMaxAttempts: 10,
  logKeepDays: 30,
};

/** The connector's own version, sent with every heartbeat; a release sets it (TC4). */
export const CONNECTOR_VERSION = '0.1.0';

/** India Standard Time is UTC+05:30 all year. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** The India date (`YYYY-MM-DD`) and minutes past midnight of an instant. */
export function istClock(at: Date): { date: string; minutes: number } {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    date: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}
