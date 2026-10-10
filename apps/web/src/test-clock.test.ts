import { DomainError } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { testClockFrom } from './test-clock';

const NOW = new Date(Date.UTC(2031, 0, 15, 5, 30));
const SHIFT = 3 * 3_600_000;
const LOCAL: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  BOS_ENVIRONMENT: 'local',
  BETTER_AUTH_URL: 'http://localhost:3031',
};

describe('the journeys’ test clock', () => {
  it('is honoured on a local runtime', () => {
    expect(testClockFrom(String(SHIFT), NOW, LOCAL)?.getTime()).toBe(NOW.getTime() + SHIFT);
    expect(testClockFrom('0', NOW, LOCAL)?.getTime()).toBe(NOW.getTime());
  });

  it('is absent without the cookie, and a cookie that is not an instant changes nothing', () => {
    expect(testClockFrom(undefined, NOW, LOCAL)).toBeUndefined();
    expect(testClockFrom('', NOW, LOCAL)).toBeUndefined();
    expect(testClockFrom('tomorrow', NOW, LOCAL)).toBeUndefined();
    expect(testClockFrom('-5', NOW, LOCAL)).toBeUndefined();
    // Further than two days is not a shift a journey needs.
    expect(testClockFrom(String(3 * 86_400_000), NOW, LOCAL)).toBeUndefined();
  });

  it('is ignored by a development server and by tests, which carry no local marker', () => {
    expect(testClockFrom(String(SHIFT), NOW, { NODE_ENV: 'development' })).toBeUndefined();
    expect(testClockFrom(String(SHIFT), NOW, { NODE_ENV: 'test' })).toBeUndefined();
    expect(
      testClockFrom(String(SHIFT), NOW, {
        NODE_ENV: 'development',
        BETTER_AUTH_URL: 'http://localhost:3031',
      }),
    ).toBeUndefined();
  });

  it('is refused on every hosted runtime', () => {
    const hosted: NodeJS.ProcessEnv[] = [
      {
        NODE_ENV: 'production',
        BOS_ENVIRONMENT: 'production',
        BETTER_AUTH_URL: 'https://bos.example.in',
      },
      {
        NODE_ENV: 'production',
        BOS_ENVIRONMENT: 'staging',
        BETTER_AUTH_URL: 'http://localhost:3031',
      },
      // The marker with an address that is not this machine, or none.
      { ...LOCAL, BETTER_AUTH_URL: 'https://bos.example.in' },
      { NODE_ENV: 'production', BOS_ENVIRONMENT: 'local' },
      // The marker on Vercel.
      { ...LOCAL, VERCEL: '1' },
    ];
    for (const env of hosted) {
      expect(() => testClockFrom(String(SHIFT), NOW, env)).toThrow(DomainError);
      // Without the cookie a hosted runtime is untouched.
      expect(testClockFrom(undefined, NOW, env)).toBeUndefined();
    }
  });
});
