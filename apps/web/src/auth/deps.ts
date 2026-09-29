import {
  consoleMailer,
  memoryKeyValue,
  recipientOnlyMailer,
  type KeyValue,
  type Logger,
  type Mailer,
} from '@shakti/domain';
import { logger } from '../log';
import { upstashKeyValue } from './upstash-key-value';

/** What the auth module needs from the outside world, injectable for tests. */
export interface AuthDeps {
  keyValue: KeyValue;
  mailer: Mailer;
  /** Used for Turnstile verification; the breached-password check has its own client. */
  fetch: typeof fetch;
  now: () => Date;
  turnstileSecretKey: string;
  /** Where the auth module reports what it cannot handle; the app's redacting logger by default. */
  logger?: Logger;
  /** The hostname a Turnstile answer must come from; unchecked with Cloudflare's test keys. */
  turnstileHostname?: string | undefined;
}

/** Variables a hosted deployment cannot run without (docs/SECURITY.md §2). */
const PRODUCTION_ENV = [
  'BOS_ENVIRONMENT',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'MAILER',
  'DATABASE_URL_OUTBOX',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
] as const;

/** Secrets that sit in the repository (the example file, CI, tests) and so protect nothing. */
const PUBLISHED_SECRETS = new Set([
  'local-only-secret-change-me-0123456789',
  'ci-only-secret-0123456789abcdef',
  'test-only-secret-test-only-secret-test-only-secret',
]);
const MIN_SECRET_LENGTH = 32;
/**
 * Which hosted environment this is. Each environment is its own Vercel project whose `main`
 * deployments are Vercel's "production" target, so `VERCEL_ENV` cannot tell staging from
 * production; this variable does.
 */
const BOS_ENVIRONMENTS = ['dev', 'staging', 'production'] as const;
/** Cloudflare's published Turnstile test keys, which pass or fail every visitor. */
const TURNSTILE_TEST_KEY = /^[123]x0+AA$/;

/** True at runtime of a hosted deployment; false locally, in tests and during `next build`. */
export function hostedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && env.NEXT_PHASE !== 'phase-production-build';
}

/** The problems that stop a hosted deployment from starting; empty when it may start. */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const missing = PRODUCTION_ENV.filter((name) => env[name] === undefined || env[name] === '');
  if (missing.length > 0) problems.push(`missing ${missing.join(', ')}`);

  const secret = env.BETTER_AUTH_SECRET ?? '';
  if (secret !== '' && (secret.length < MIN_SECRET_LENGTH || PUBLISHED_SECRETS.has(secret))) {
    problems.push(
      `BETTER_AUTH_SECRET must be a private value of at least ${String(MIN_SECRET_LENGTH)} characters`,
    );
  }
  const environment = env.BOS_ENVIRONMENT ?? '';
  if (environment !== '' && !(BOS_ENVIRONMENTS as readonly string[]).includes(environment)) {
    problems.push(`BOS_ENVIRONMENT must be one of ${BOS_ENVIRONMENTS.join(', ')}`);
  }
  const url = env.BETTER_AUTH_URL ?? '';
  if (url !== '' && !url.startsWith('https://')) problems.push('BETTER_AUTH_URL must use https');
  for (const name of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as const) {
    if (TURNSTILE_TEST_KEY.test(env[name] ?? '')) {
      problems.push(`${name} is a Cloudflare test key, which turns the bot check off`);
    }
  }

  // No mail provider is wired yet (SES arrives before any environment holds real staff). Until
  // then a hosted environment other than production may log that a message went out, never the
  // message: a set-password link in a log opens the account (AUDIT M9).
  const mailer = env.MAILER ?? '';
  if (environment === 'production') {
    if (mailer !== '')
      problems.push(`MAILER=${mailer} is not a mail provider; production needs one`);
  } else if (mailer !== '' && mailer !== 'log') {
    problems.push('MAILER must be "log" on a hosted environment without a mail provider');
  }
  return problems;
}

/**
 * A hosted deployment fails to start rather than degrade: lockouts and the principal cache must
 * be shared across function instances, the bot check must be real, and a set-password link must
 * never be printed to a log. Called from `instrumentation.ts` at start and again before first use.
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) {
    throw new Error(`this deployment cannot start: ${problems.join('; ')}`);
  }
}

/** Upstash Redis when configured, otherwise the in-memory store (local development and CI). */
function upstashOrMemoryKeyValue(): KeyValue {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url === undefined || url === '' || token === undefined || token === '') {
    return memoryKeyValue();
  }
  return upstashKeyValue({ url, token });
}

function hostnameOf(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

let deps: AuthDeps | undefined;

export function defaultAuthDeps(): AuthDeps {
  const hosted = hostedRuntime();
  if (deps === undefined && hosted) assertProductionConfig();
  deps ??= {
    keyValue: upstashOrMemoryKeyValue(),
    // Full messages only on a developer's machine; hosted runtimes log the recipient only.
    mailer: hosted ? recipientOnlyMailer() : consoleMailer(),
    fetch: (...args) => fetch(...args),
    now: () => new Date(),
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
    logger,
    turnstileHostname: hostnameOf(process.env.BETTER_AUTH_URL),
  };
  return deps;
}
