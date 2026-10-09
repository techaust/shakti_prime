import type { BrowserContext } from '@playwright/test';
import { test } from '@playwright/test';

/**
 * The server's calling-hours clock for a journey (`apps/web/src/test-clock.ts`). Only the app
 * started by the journeys (`BOS_ENVIRONMENT=local` on this machine) honours the cookie, so a
 * journey runs the inside and the outside of the TRAI hours on any wall clock.
 */
const TEST_CLOCK_COOKIE = 'bos-test-clock';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The latest moment at the given hour of the Indian day that is not after `now`. */
function latestAtIst(hour: number, now: Date): Date {
  const shifted = now.getTime() + IST_OFFSET_MS;
  const dayStart = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS);
  const at = dayStart + hour * HOUR_MS - IST_OFFSET_MS;
  return new Date(at <= now.getTime() ? at : at - DAY_MS);
}

/** 11 AM in India, inside the calling hours (9 AM to 9 PM). */
export function insideCallingHours(now = new Date()): Date {
  return latestAtIst(11, now);
}

/** 11 PM in India, outside the calling hours. */
export function outsideCallingHours(now = new Date()): Date {
  return latestAtIst(23, now);
}

/** Has the app treat `at` as the time of day for the calls this browser context makes. */
export async function setServerClock(context: BrowserContext, at: Date): Promise<void> {
  const url = test.info().project.use.baseURL;
  if (url === undefined) throw new Error('the project has no base address');
  await context.addCookies([{ name: TEST_CLOCK_COOKIE, value: String(at.getTime()), url }]);
}
