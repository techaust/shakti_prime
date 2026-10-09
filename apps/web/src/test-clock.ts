import { DomainError } from '@shakti/contracts';
import { hostedRuntime, localRuntime } from './auth/deps';

/**
 * The journeys' clock for the calling-hours rule (TRAI, 09:00 to 21:00 IST). The rule itself reads
 * the time it is given; the journeys set this cookie to a number of milliseconds the server adds to
 * its own clock, so a journey exercises the inside and the outside of the hours on any wall clock,
 * instead of choosing a branch from its own. The clock only moves forward (the records a journey
 * made just before are never newer than "now") and keeps running, so a journey's own rows keep
 * their order.
 *
 * It is honoured only by a runtime that carries the local marker (`localRuntime()`). Any other
 * runtime ignores it, and a hosted runtime refuses a request that carries it, so a copied cookie
 * never moves a real deployment's clock.
 */
export const TEST_CLOCK_COOKIE = 'bos-test-clock';

/** The furthest the clock may be moved: two days. */
const MAX_SHIFT_MS = 2 * 86_400_000;

/** The moment the cookie's shift gives from `now`, or `undefined` when the server's clock stands. */
export function testClockFrom(
  cookie: string | undefined,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Date | undefined {
  if (cookie === undefined || cookie === '') return undefined;
  if (hostedRuntime(env)) throw new DomainError('forbidden', 'the test clock is not available here');
  if (!localRuntime(env)) return undefined;
  if (!/^\d{1,10}$/.test(cookie)) return undefined;
  const shift = Number(cookie);
  if (shift > MAX_SHIFT_MS) return undefined;
  return new Date(now.getTime() + shift);
}
