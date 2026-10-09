import { DomainError } from '@shakti/contracts';
import { hostedRuntime, localRuntime } from './auth/deps';

/**
 * The journeys' clock for the calling-hours rule (TRAI, 09:00 to 21:00 IST). The rule itself reads
 * the time it is given; the journeys set this cookie to the instant (milliseconds since 1970) the
 * server should treat as now, so a journey exercises the inside and the outside of the hours on
 * any wall clock, instead of choosing a branch from its own.
 *
 * It is honoured only by a runtime that carries the local marker (`localRuntime()`). Any other
 * runtime ignores it, and a hosted runtime refuses a request that carries it, so a copied cookie
 * never moves a real deployment's clock.
 */
export const TEST_CLOCK_COOKIE = 'bos-test-clock';

/** The instant the cookie names, or `undefined` when the server's own clock applies. */
export function testClockFrom(
  cookie: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Date | undefined {
  if (cookie === undefined || cookie === '') return undefined;
  if (hostedRuntime(env)) throw new DomainError('forbidden', 'the test clock is not available here');
  if (!localRuntime(env)) return undefined;
  if (!/^\d{1,15}$/.test(cookie)) return undefined;
  const at = new Date(Number(cookie));
  return Number.isNaN(at.getTime()) ? undefined : at;
}
