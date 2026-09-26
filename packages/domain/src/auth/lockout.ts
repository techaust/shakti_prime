import { DomainError } from '@shakti/contracts';
import type { KeyValue } from '../ports/key-value';

/** Failures allowed before the first wait (docs/SECURITY.md §2). */
export const LOCKOUT_FREE_ATTEMPTS = 5;
export const LOCKOUT_FIRST_WAIT_SECONDS = 60;
export const LOCKOUT_MAX_WAIT_SECONDS = 60 * 60;
/** A quiet day clears the counter. */
export const LOCKOUT_COUNTER_TTL_SECONDS = 24 * 60 * 60;

/** Seconds the caller must wait after `failures` consecutive failures: 0, then 1 min doubling to 1 h. */
export function lockoutDelaySeconds(failures: number): number {
  if (failures < LOCKOUT_FREE_ATTEMPTS) return 0;
  const doublings = failures - LOCKOUT_FREE_ATTEMPTS;
  const seconds = LOCKOUT_FIRST_WAIT_SECONDS * 2 ** Math.min(doublings, 20);
  return Math.min(seconds, LOCKOUT_MAX_WAIT_SECONDS);
}

interface LockState {
  failures: number;
  /** Unix milliseconds until which attempts are refused. */
  until: number;
}

function parse(raw: string | null): LockState {
  if (raw === null) return { failures: 0, until: 0 };
  try {
    const value = JSON.parse(raw) as Partial<LockState>;
    return {
      failures: typeof value.failures === 'number' ? value.failures : 0,
      until: typeof value.until === 'number' ? value.until : 0,
    };
  } catch {
    return { failures: 0, until: 0 };
  }
}

/**
 * Exponential lockout per account and per IP on top of `KeyValue`. `check` throws
 * `rate_limited` with `details.retryAfterSeconds` while a wait is running; `recordFailure`
 * lengthens the wait; `reset` clears the keys after a success.
 */
export function createLockout(store: KeyValue, now: () => number = Date.now) {
  const key = (k: string) => `lockout:${k}`;
  return {
    async check(keys: readonly string[]): Promise<void> {
      let retryAfter = 0;
      for (const k of keys) {
        const state = parse(await store.get(key(k)));
        retryAfter = Math.max(retryAfter, Math.ceil((state.until - now()) / 1000));
      }
      if (retryAfter > 0) {
        throw new DomainError('rate_limited', 'too many failed attempts', {
          reason: 'account_locked',
          retryAfterSeconds: retryAfter,
        });
      }
    },
    async recordFailure(keys: readonly string[]): Promise<void> {
      for (const k of keys) {
        const state = parse(await store.get(key(k)));
        const failures = state.failures + 1;
        const wait = lockoutDelaySeconds(failures);
        const next: LockState = { failures, until: wait > 0 ? now() + wait * 1000 : 0 };
        await store.set(key(k), JSON.stringify(next), LOCKOUT_COUNTER_TTL_SECONDS);
      }
    },
    async reset(keys: readonly string[]): Promise<void> {
      for (const k of keys) await store.del(key(k));
    },
  };
}

export type Lockout = ReturnType<typeof createLockout>;
