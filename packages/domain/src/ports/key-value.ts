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
  };
}
