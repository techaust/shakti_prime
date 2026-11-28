import { isDomainError, type ErrorCode } from '@shakti/contracts';

/**
 * The conflict rules of the field app's push (ADR 0012, docs/03-roadmap-appendix/phase4.md §7.4),
 * each a pure function. A collection names the rule its commands follow (`collections.ts`); the
 * push applies it to the command's outcome and answers `conflict` with the server's record, or
 * `rejected` with the error's code and reason. Nothing here decides for the person: a conflict
 * goes to the app's Conflicts screen, where they choose.
 */

export type SyncConflictReason =
  | 'state_changed'
  | 'field_newer_on_server'
  | 'record_removed'
  | 'stock_short';

/**
 * - `state`: transitions are the server's; a move the record's state no longer allows is
 *   `state_changed`.
 * - `fields`: an edit merges field by field by `clientTime`; a field someone else changed on the
 *   server after the engineer did is `field_newer_on_server`, and the others apply.
 * - `stock`: a movement the stock cannot cover is `stock_short`.
 * - `none`: the collection takes no command (reference data).
 */
export type ConflictRule = 'state' | 'fields' | 'stock' | 'none';

/**
 * Reasons that say the call may succeed when sent again unchanged, not that the record moved on:
 * the app keeps such a command waiting and sends it with the next sync.
 */
export const RETRY_LATER_REASONS = ['concurrent_change'] as const;

/** Codes that say the same: the server or a service it needs could not answer just then. */
export const RETRY_LATER_CODES: readonly ErrorCode[] = [
  'internal',
  'integration_unavailable',
  'rate_limited',
];

function reasonOf(error: unknown): string | undefined {
  if (!isDomainError(error)) return undefined;
  const reason = error.details?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * `state_changed`: the server refused the move as the record stands now, a step already done or
 * out of order, a project on hold. The record's machine answers `conflict` for those; a retry
 * reason or a reused key is not a change of state.
 */
export function isStateChanged(error: unknown): boolean {
  if (!isDomainError(error) || error.code !== 'conflict') return false;
  const reason = reasonOf(error);
  return (
    reason !== 'idempotency_mismatch' &&
    !(RETRY_LATER_REASONS as readonly string[]).includes(reason ?? '')
  );
}

/** `stock_short`: the ledger could not cover the movement (`stock_insufficient`). */
export function isStockShort(error: unknown): boolean {
  return reasonOf(error) === 'stock_insufficient';
}

/**
 * `record_removed`: the command could not find its record, and the person no longer reads it:
 * removed, or taken off the project. A record still there with something else missing is a
 * rejection the person can act on, not a removal.
 */
export function isRecordRemoved(error: unknown, recordStillReadable: boolean): boolean {
  return isDomainError(error) && error.code === 'not_found' && !recordStillReadable;
}

/** When a field last changed on the server, and by whom (`customer_sites.field_changed_at`). */
export interface FieldStamp {
  at: string;
  by: string | null;
}

/**
 * The fields of an edit that the server changed later than the engineer did: someone else's
 * change, stamped after `clientTime`, to a value other than the engineer's. A field the engineer
 * changed to what the server holds already is no conflict; neither is one the same person changed
 * last, which is their own earlier edit sent before this one.
 */
export function fieldsNewerOnServer(args: {
  sent: Readonly<Record<string, unknown>>;
  server: Readonly<Record<string, unknown>>;
  stamps: Readonly<Record<string, FieldStamp | undefined>>;
  clientTime: string;
  personId: string;
}): string[] {
  const acted = Date.parse(args.clientTime);
  return Object.keys(args.sent)
    .filter((field) => {
      const stamp = args.stamps[field];
      if (stamp === undefined || stamp.by === args.personId) return false;
      const changed = Date.parse(stamp.at);
      if (Number.isNaN(changed) || changed <= acted) return false;
      return !sameValue(args.sent[field], args.server[field]);
    })
    .sort();
}

/** Two field values alike, as JSON reads them (`{ lat, lng }` objects compared by value). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** How a push answers a command that failed. */
export type FailureAnswer =
  | { status: 'conflict'; reason: SyncConflictReason }
  | { status: 'rejected'; code: ErrorCode; reason?: string };

/**
 * The answer to a command that failed, by its collection's rule: a removed record first (any
 * collection), then the rule's own conflict, else a rejection with the error's code and reason.
 */
export function answerFailure(
  error: unknown,
  rule: ConflictRule,
  recordStillReadable: boolean,
): FailureAnswer {
  if (isRecordRemoved(error, recordStillReadable)) {
    return { status: 'conflict', reason: 'record_removed' };
  }
  if (rule === 'state' && isStateChanged(error)) return { status: 'conflict', reason: 'state_changed' };
  if (rule === 'stock' && isStockShort(error)) return { status: 'conflict', reason: 'stock_short' };
  if (!isDomainError(error)) return { status: 'rejected', code: 'internal' };
  const reason = reasonOf(error);
  return {
    status: 'rejected',
    code: error.code,
    ...(reason !== undefined && /^[a-z_]+$/.test(reason) ? { reason } : {}),
  };
}
