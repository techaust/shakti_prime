import { describe, expect, it } from 'vitest';
import { hostedRuntime, productionConfigProblems } from './deps';

// Values shaped like real ones; none of them is a real credential.
const GOOD: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  // Each environment's own Vercel project serves `main` as Vercel's production target.
  VERCEL_ENV: 'production',
  BOS_ENVIRONMENT: 'staging',
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
      'BOS_ENVIRONMENT, BETTER_AUTH_SECRET, BETTER_AUTH_URL',
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
    ['an unknown environment name', { BOS_ENVIRONMENT: 'prod' }],
  ])('refuses %s', (_label, change) => {
    expect(productionConfigProblems({ ...GOOD, ...change })).toHaveLength(1);
  });

  it('accepts the log mailer on dev and staging, on any Vercel target', () => {
    for (const BOS_ENVIRONMENT of ['dev', 'staging']) {
      for (const VERCEL_ENV of ['production', 'preview']) {
        expect(productionConfigProblems({ ...GOOD, BOS_ENVIRONMENT, VERCEL_ENV })).toEqual([]);
      }
    }
  });

  it('refuses production until a mail provider exists', () => {
    expect(productionConfigProblems({ ...GOOD, BOS_ENVIRONMENT: 'production' })).toEqual([
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

  it('is false only for a local production build that runs on this machine, never on Vercel', () => {
    const local: NodeJS.ProcessEnv = { NODE_ENV: 'production', BOS_ENVIRONMENT: 'local' };
    for (const url of ['http://localhost:3031', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(hostedRuntime({ ...local, BETTER_AUTH_URL: url })).toBe(false);
    }
    // The marker with any other address, or with none, is a hosted runtime and fails closed.
    for (const url of [
      'https://bos.example.in',
      'http://192.168.1.67:3031',
      'http://localhost.example.in',
      'not a url',
      '',
    ]) {
      expect(hostedRuntime({ ...local, BETTER_AUTH_URL: url })).toBe(true);
    }
    expect(hostedRuntime(local)).toBe(true);
    expect(hostedRuntime({ ...local, BETTER_AUTH_URL: 'http://localhost:3031', VERCEL: '1' })).toBe(
      true,
    );
    expect(
      hostedRuntime({
        NODE_ENV: 'production',
        BOS_ENVIRONMENT: 'staging',
        BETTER_AUTH_URL: 'http://localhost:3031',
      }),
    ).toBe(true);
    expect(
      hostedRuntime({
        ...local,
        BOS_ENVIRONMENT: 'Local',
        BETTER_AUTH_URL: 'http://localhost:3031',
      }),
    ).toBe(true);
  });

  it('refuses to start on Vercel with the local marker', () => {
    const env = { ...GOOD, BOS_ENVIRONMENT: 'local', VERCEL: '1' };
    expect(hostedRuntime(env)).toBe(true);
    expect(productionConfigProblems(env)).toEqual([
      'BOS_ENVIRONMENT must be one of dev, staging, production',
    ]);
  });
});
