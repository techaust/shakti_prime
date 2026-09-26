import { consoleMailer, memoryKeyValue, type KeyValue, type Mailer } from '@shakti/domain';
import { Redis } from '@upstash/redis';

/** What the auth module needs from the outside world, injectable for tests. */
export interface AuthDeps {
  keyValue: KeyValue;
  mailer: Mailer;
  /** Used for Turnstile verification; the breached-password check has its own client. */
  fetch: typeof fetch;
  now: () => Date;
  turnstileSecretKey: string;
}

/** Upstash Redis when configured, otherwise the in-memory store (local development and CI). */
export function upstashOrMemoryKeyValue(): KeyValue {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url === undefined || url === '' || token === undefined || token === '') {
    return memoryKeyValue();
  }
  const redis = new Redis({ url, token });
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
    incr: async (key, ttlSeconds) => {
      const next = await redis.incr(key);
      if (next === 1) await redis.expire(key, ttlSeconds);
      return next;
    },
  };
}

let deps: AuthDeps | undefined;

export function defaultAuthDeps(): AuthDeps {
  deps ??= {
    keyValue: upstashOrMemoryKeyValue(),
    mailer: consoleMailer(),
    fetch: (...args) => fetch(...args),
    now: () => new Date(),
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
  };
  return deps;
}
