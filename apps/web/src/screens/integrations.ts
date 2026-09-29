// Integration Health's reading of the outbox (docs/design/phase1.md §5.2). Pure functions, so the
// screen and its tests share them.

/** Why an update was held back, by the key of its sentence under `integrations.reasons`. */
export type HeldReasonKey = 'queue' | 'worker' | 'retired' | 'interrupted' | 'other';

/** Codes the delivery service or the publisher records when the service did not take an update. */
const QUEUE_CODES: ReadonlySet<string> = new Set([
  'queue_refused',
  'queue_not_configured',
  'no_answer',
  'publish_failed',
  'TimeoutError',
  'AbortError',
]);

/**
 * Codes of a worker's failure: `worker_failed` and `worker_refused` from QStash's failure callback,
 * and the codes a worker answers with (`ErrorCode`) when it was called in this process.
 */
const WORKER_CODES: ReadonlySet<string> = new Set([
  'worker_failed',
  'worker_refused',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'integration_unavailable',
  'internal',
]);

/**
 * The sentence for a held-back update's last error code (`DeadLetteredEvent.errorCode`): the
 * delivery service refused it, its worker failed, its kind left the catalogue, or its sending runs
 * kept stopping part way; any other code, or none, is `other`.
 */
export function heldReason(code: string | null): HeldReasonKey {
  if (code === null) return 'other';
  if (code === 'not_in_catalogue') return 'retired';
  if (code === 'no_outcome') return 'interrupted';
  if (QUEUE_CODES.has(code) || /^http_\d{3}$/.test(code)) return 'queue';
  if (WORKER_CODES.has(code)) return 'worker';
  return 'other';
}

/** How often the page asks again while a delivery check is on its way, and for how long. */
export const CHECK_POLL_MS = 1_000;
export const CHECK_POLL_TRIES = 20;
