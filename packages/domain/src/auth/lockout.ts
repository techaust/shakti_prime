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

/** Every this many failures on one account, from any address, the owner is told by email. */
export const SIGN_IN_NOTICE_EVERY = 10;
/** Clearing a lock moves the account to a new generation of pair keys; this outlives them. */
const GENERATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The sign-in lockout policy (docs/SECURITY.md §2, AUDIT M6). The exponential lock applies to
 * one account from one address, so a stranger who knows an Executive's email cannot keep them
 * out, and one office address is not locked for everyone behind it by one person's typos. The
 * account-wide count only escalates: every tenth failure tells the owner. Per-address request
 * caps bound what one address can try across accounts.
 */
export function createSignInGuard(store: KeyValue, now: () => number = Date.now) {
  const lockout = createLockout(store, now);
  const account = (email: string) => email.trim().toLowerCase();
  const generationKey = (acct: string) => `signin-gen:${acct}`;
  const failuresKey = (acct: string) => `signin-fail:${acct}`;
  async function pairKey(acct: string, address: string | undefined): Promise<string> {
    const generation = (await store.get(generationKey(acct))) ?? '0';
    return `pair:${acct}:${generation}|${address ?? 'unknown'}`;
  }
  return {
    /** Throws `rate_limited` while this account is locked from this address. */
    async check(email: string, address: string | undefined): Promise<void> {
      await lockout.check([await pairKey(account(email), address)]);
    },
    /** Records a wrong password; `notify` is true when the owner should be told. */
    async recordFailure(email: string, address: string | undefined): Promise<{ notify: boolean }> {
      const acct = account(email);
      await lockout.recordFailure([await pairKey(acct, address)]);
      const total = await store.incr(failuresKey(acct), LOCKOUT_COUNTER_TTL_SECONDS);
      return { notify: total % SIGN_IN_NOTICE_EVERY === 0 };
    },
    /** A completed sign-in (after the second factor, where there is one). */
    async succeeded(email: string, address: string | undefined): Promise<void> {
      const acct = account(email);
      await lockout.reset([await pairKey(acct, address)]);
      await store.del(failuresKey(acct));
    },
    /** An administrator lifts every lock on the account, from every address. */
    async clear(email: string): Promise<void> {
      const acct = account(email);
      await store.incr(generationKey(acct), GENERATION_TTL_SECONDS);
      await store.del(failuresKey(acct));
    },
  };
}

export type SignInGuard = ReturnType<typeof createSignInGuard>;
