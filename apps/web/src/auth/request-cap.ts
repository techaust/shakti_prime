import type { KeyValue } from '@shakti/domain';

/** A fixed window: at most `max` requests per `window` seconds under one key. */
export interface CapRule {
  window: number;
  max: number;
}

/**
 * The key a request is counted under when no address can be read for it. Those requests share
 * one count per path, so a missing or unreadable address never lifts a cap (docs/SECURITY.md §2).
 */
export const NO_ADDRESS = 'no-address';

/** The per-address part of a cap key: the address, or the shared one when there is none. */
export function addressKey(address: string | undefined): string {
  return address ?? NO_ADDRESS;
}

/**
 * Counts one request against a fixed-window cap in the shared store, so the cap holds across
 * function instances. Answers how long to wait once the cap is passed.
 */
export async function countRequest(
  store: KeyValue,
  key: string,
  rule: CapRule,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const count = await store.incr(`cap:${key}`, rule.window);
  return count <= rule.max ? { allowed: true } : { allowed: false, retryAfter: rule.window };
}
