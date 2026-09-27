import { describe, expect, it } from 'vitest';
import { hostedRuntime, productionConfigProblems } from './deps';

// Values shaped like real ones; none of them is a real credential.
const GOOD: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  BETTER_AUTH_SECRET: 'a private value of forty characters okay',
  BETTER_AUTH_URL: 'https://bos.example.in',
  TURNSTILE_SITE_KEY: '0x4AAAAAAAsitekeyvalue',
  TURNSTILE_SECRET_KEY: '0x4AAAAAAAsecretkeyvalue',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-value',
  MAILER: 'log',
  DATABASE_URL_OUTBOX: 'postgres://outbox_publisher:value@db.example.in:6543/postgres',
  QSTASH_TOKEN: 'qstash-value',
  QSTASH_CURRENT_SIGNING_KEY: 'qstash-current-value',
  QSTASH_NEXT_SIGNING_KEY: 'qstash-next-value',
};

describe('productionConfigProblems (AUDIT M8, M9)', () => {
  it('accepts a complete hosted configuration that is not production', () => {
    expect(productionConfigProblems(GOOD)).toEqual([]);
  });

  it('names every missing variable', () => {
    expect(productionConfigProblems({ NODE_ENV: 'production' })[0]).toContain(
      'BETTER_AUTH_SECRET, BETTER_AUTH_URL',
    );
  });

  it('refuses to start without the outbox connection and the queue', () => {
    const without = { ...GOOD, DATABASE_URL_OUTBOX: '', QSTASH_NEXT_SIGNING_KEY: '' };
    expect(productionConfigProblems(without)).toEqual([
      'missing DATABASE_URL_OUTBOX, QSTASH_NEXT_SIGNING_KEY',
    ]);
  });

  it.each([
    ['the example-file secret', { BETTER_AUTH_SECRET: 'local-only-secret-change-me-0123456789' }],
    ['the CI secret', { BETTER_AUTH_SECRET: 'ci-only-secret-0123456789abcdef' }],
    ['a short secret', { BETTER_AUTH_SECRET: 'short' }],
    ['a plain http address', { BETTER_AUTH_URL: 'http://bos.example.in' }],
    ['the always-pass Turnstile site key', { TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }],
    [
      'the always-fail Turnstile secret',
      { TURNSTILE_SECRET_KEY: '2x0000000000000000000000000000000AA' },
    ],
    ['a mailer that prints whole messages', { MAILER: 'console' }],
  ])('refuses %s', (_label, change) => {
    expect(productionConfigProblems({ ...GOOD, ...change })).toHaveLength(1);
  });

  it('refuses production until a mail provider exists', () => {
    expect(productionConfigProblems({ ...GOOD, VERCEL_ENV: 'production' })).toEqual([
      'MAILER=log is not a mail provider; production needs one',
    ]);
  });
});

describe('hostedRuntime', () => {
  it('is false during the build and outside production', () => {
    expect(hostedRuntime({ NODE_ENV: 'production' })).toBe(true);
    expect(hostedRuntime({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })).toBe(
      false,
    );
    expect(hostedRuntime({ NODE_ENV: 'development' })).toBe(false);
  });
});
