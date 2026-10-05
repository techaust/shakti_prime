/**
 * The small key-value surface the domain needs from Redis (lockouts, principal cache, event
 * ids). Upstash Redis implements it in apps/web; tests and local development use the in-memory
 * store. Values are strings; callers serialise.
 */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  /** Sets the value with a time to live in seconds. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Increments an integer value, creating it at 1 with the given time to live. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /**
   * Adds a whole number, which may be negative, to an integer value in one step, creating it at
   * that number with the given time to live (an agent's spend today, in paise, reserved before a
   * call and settled after it); answers the total afterwards.
   */
  incrBy(key: string, amount: number, ttlSeconds: number): Promise<number>;
  /**
   * Sets the value only when the key holds none (Redis `SET NX EX`), in one step, so two callers
   * never both get it: true for the caller that set it.
   */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /**
   * Raises a stored whole number to `value` when `value` is larger, or stores it when there is none,
   * in one step, with the given time to live; answers the number stored afterwards. Both are
   * non-negative whole numbers written without leading zeros (an outbox sequence).
   */
  raiseTo(key: string, value: string, ttlSeconds: number): Promise<string>;
}

/** Whether one non-negative whole number, as written without leading zeros, exceeds another. */
export function greaterNumber(a: string, b: string): boolean {
  return a.length === b.length ? a > b : a.length > b.length;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** In-memory store for tests and single-process development. Not shared across instances. */
export function memoryKeyValue(now: () => number = Date.now): KeyValue {
  const entries = new Map<string, Entry>();
  const live = (key: string): Entry | undefined => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    get: (key) => Promise.resolve(live(key)?.value ?? null),
    set: (key, value, ttlSeconds) => {
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return Promise.resolve();
    },
    del: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    incr: (key, ttlSeconds) => {
      const entry = live(key);
      const next = (entry ? Number(entry.value) : 0) + 1;
      entries.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? now() + ttlSeconds * 1000,
      });
      return Promise.resolve(next);
    },
    incrBy: (key, amount, ttlSeconds) => {
      const entry = live(key);
      const next = (entry ? Number(entry.value) : 0) + amount;
      entries.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? now() + ttlSeconds * 1000,
      });
      return Promise.resolve(next);
    },
    setIfAbsent: (key, value, ttlSeconds) => {
      if (live(key) !== undefined) return Promise.resolve(false);
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return Promise.resolve(true);
    },
    raiseTo: (key, value, ttlSeconds) => {
      const entry = live(key);
      if (entry !== undefined && !greaterNumber(value, entry.value)) {
        return Promise.resolve(entry.value);
      }
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return Promise.resolve(value);
    },
  };
}
