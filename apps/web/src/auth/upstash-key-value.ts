import type { KeyValue } from '@shakti/domain';
import { Redis } from '@upstash/redis';

/**
 * `raiseTo` in one step on the server: the larger of the stored number and the given one stays,
 * compared as whole numbers written without leading zeros (by length, then digit by digit), so no
 * number is ever read as a floating-point value.
 */
const RAISE_TO = `local cur = redis.call('GET', KEYS[1])
local v = ARGV[1]
if cur and (string.len(cur) > string.len(v) or (string.len(cur) == string.len(v) and cur >= v)) then
  return cur
end
redis.call('SET', KEYS[1], v, 'EX', tonumber(ARGV[2]))
return v`;

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
    // As `incr`: the key exists with its time to live before the amount is added.
    incrBy: async (key, amount, ttlSeconds) => {
      const [, total] = await redis
        .multi()
        .set(key, 0, { ex: ttlSeconds, nx: true })
        .incrby(key, amount)
        .exec<[unknown, number]>();
      return total;
    },
    setIfAbsent: async (key, value, ttlSeconds) => {
      const answer = await redis.set(key, value, { ex: ttlSeconds, nx: true });
      return answer !== null;
    },
    raiseTo: async (key, value, ttlSeconds) => {
      const stored = await redis.eval<[string, string], string | number>(
        RAISE_TO,
        [key],
        [value, String(ttlSeconds)],
      );
      return String(stored);
    },
  };
}
