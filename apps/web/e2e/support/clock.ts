import type { BrowserContext } from '@playwright/test';
import { test } from '@playwright/test';

/**
 * The server's calling-hours clock for a journey (`apps/web/src/test-clock.ts`): the cookie holds
 * the milliseconds the server adds to its own clock. Only the app started by the journeys
 * (`BOS_ENVIRONMENT=local` on this machine) honours it, so a journey runs the inside and the
 * outside of the TRAI hours on any wall clock. The clock only moves forward, so the records the
 * journey made a moment before are never newer than the server's "now".
 */
const TEST_CLOCK_COOKIE = 'bos-test-clock';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Minutes since midnight in India. */
function istMinute(at: Date): number {
  return Math.floor((((at.getTime() + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / MINUTE_MS);
}

/** The shift, in milliseconds, that makes the server's time of day `minute` at or after `now`. */
function shiftToMinute(now: Date, minute: number): number {
  const wait = (minute - istMinute(now) + 1440) % 1440;
  return wait * MINUTE_MS - (now.getTime() % MINUTE_MS);
}

/**
 * A shift that puts the server inside the calling hours (9 AM to 9 PM) for the next few minutes:
 * none when the wall clock is well inside them, else the next 9:20 AM. A callback the workspace
 * proposes is 10 AM the next day (counted from the wall clock), so the shifted clock stays before it.
 */
export function insideCallingHours(now = new Date()): number {
  const minute = istMinute(now);
  return minute >= 9 * 60 + 20 && minute < 20 * 60 + 30 ? 0 : shiftToMinute(now, 9 * 60 + 20);
}

/** A shift that puts the server outside the calling hours for the next few minutes. */
export function outsideCallingHours(now = new Date()): number {
  const minute = istMinute(now);
  return minute >= 21 * 60 + 10 || minute < 8 * 60 + 50 ? 0 : shiftToMinute(now, 22 * 60);
}

/** Has the app add `shiftMs` to its clock for the calls this browser context makes. */
export async function setServerClock(context: BrowserContext, shiftMs: number): Promise<void> {
  const url = test.info().project.use.baseURL;
  if (url === undefined) throw new Error('the project has no base address');
  await context.addCookies([{ name: TEST_CLOCK_COOKIE, value: String(shiftMs), url }]);
}
