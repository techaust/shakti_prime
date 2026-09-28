import type { KeyValue } from '@shakti/domain';
import { Redis } from '@upstash/redis';

/** Deadline for one Upstash call: the store sits on the path of every signed-in request. */
const UPSTASH_CALL_TIMEOUT_MS = 1000;

export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * The `KeyValue` port on Upstash Redis. Values are the exact strings callers stored: with the
 * SDK's default deserialisation a stored JSON string came back as an object, which the principal
 * cache and the lockout then read as "[object Object]" (AUDIT C1).
 */
export function upstashKeyValue(config: UpstashConfig): KeyValue {
  const redis = new Redis({
    url: config.url,
    token: config.token,
    automaticDeserialization: false,
    retry: { retries: 1, backoff: () => 50 },
    // The function form gives the call a fresh deadline and makes a timeout throw; a static
    // signal would turn the abort into a successful "Aborted" result.
    signal: () => AbortSignal.timeout(UPSTASH_CALL_TIMEOUT_MS),
  });
  return {
    get: async (key) => {
      const value = await redis.get<string | number>(key);
      return value === null ? null : String(value);
    },
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, { ex: ttlSeconds });
    },
    del: async (key) => {
      await redis.del(key);
    },
    // One transaction: the key is created with its time to live before the first increment, so a
    // lost second call can never leave a counter that never expires (AUDIT M28).
    incr: async (key, ttlSeconds) => {
      const [, count] = await redis
        .multi()
        .set(key, 0, { ex: ttlSeconds, nx: true })
        .incr(key)
        .exec<[unknown, number]>();
      return count;
    },
  };
}
