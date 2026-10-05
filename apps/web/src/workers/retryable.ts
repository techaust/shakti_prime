import { DomainError } from '@shakti/contracts';

/**
 * Whether a worker's failure is a wait that ran out rather than a fault: a lock wait past the
 * connection's `lock_timeout` (`lock_not_available`, 55P03) or a statement cut off
 * (`query_canceled`, 57014). The worker answers 503, and QStash tries the call again.
 */
export function isRetryableWait(error: unknown): boolean {
  const state = error instanceof DomainError ? error.details?.sqlstate : undefined;
  return state === '55P03' || state === '57014';
}
