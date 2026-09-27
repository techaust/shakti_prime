import { consoleMailer, memoryKeyValue, type KeyValue, type Mailer } from '@shakti/domain';
import { upstashKeyValue } from './upstash-key-value';

/** What the auth module needs from the outside world, injectable for tests. */
export interface AuthDeps {
  keyValue: KeyValue;
  mailer: Mailer;
  /** Used for Turnstile verification; the breached-password check has its own client. */
  fetch: typeof fetch;
  now: () => Date;
  turnstileSecretKey: string;
}

/** Variables a hosted deployment cannot run without (docs/SECURITY.md §2). */
const PRODUCTION_ENV = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

/** True at runtime of a production deployment; false locally, in tests and during `next build`. */
function hostedRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build'
  );
}

/**
 * A hosted deployment fails to start rather than degrade: lockouts and the principal cache must
 * be shared across function instances, and a set-password link must never be printed to a log.
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const missing = PRODUCTION_ENV.filter((name) => env[name] === undefined || env[name] === '');
  if (missing.length > 0) {
    throw new Error(`production deployment is missing ${missing.join(', ')}`);
  }
  if (env.MAILER !== 'console') {
    throw new Error(
      'MAILER is not set: no mail provider is configured yet. MAILER=console prints links to the log and is for internal environments only.',
    );
  }
}

/** Upstash Redis when configured, otherwise the in-memory store (local development and CI). */
export function upstashOrMemoryKeyValue(): KeyValue {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url === undefined || url === '' || token === undefined || token === '') {
    return memoryKeyValue();
  }
  return upstashKeyValue({ url, token });
}

let deps: AuthDeps | undefined;

export function defaultAuthDeps(): AuthDeps {
  if (deps === undefined && hostedRuntime()) assertProductionConfig();
  deps ??= {
    keyValue: upstashOrMemoryKeyValue(),
    mailer: consoleMailer(),
    fetch: (...args) => fetch(...args),
    now: () => new Date(),
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
  };
  return deps;
}
