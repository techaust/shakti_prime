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
  return Math.floor(((((at.getTime() + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS);
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

/** 11:00 in India: inside the calling hours, with hours to spare either side. */
export const INSIDE_CALLING_HOURS_MINUTE = 11 * 60;
/** 22:00 in India: outside the calling hours, an hour after they end. */
export const OUTSIDE_CALLING_HOURS_MINUTE = 22 * 60;

/**
 * The shift, in milliseconds, to the next moment after `now` whose time in India is `minute`
 * minutes past midnight, on the minute: always forward, by more than nothing and less than a day,
 * whatever the wall clock says. A journey that moves its clocks with it runs the same path, the
 * moved one, on every run: the wall clock never chooses between a moved and an unmoved clock.
 */
export function shiftToIstMinute(minute: number, now = new Date()): number {
  const wait = (minute - istMinute(now) + 1440) % 1440;
  const shift = wait * MINUTE_MS - (now.getTime() % MINUTE_MS);
  return shift > 0 ? shift : shift + DAY_MS;
}

/**
 * Moves both clocks of a browser context by `shiftMs`, before its first page opens: the server's
 * (`setServerClock`) and the browser's own (Playwright's clock, which keeps running in real time
 * from the moved moment and fires the page's timers as usual). The two then agree, as a caller's
 * device and the server do, so the screen reads the server's times against a clock that matches.
 */
export async function setClocks(context: BrowserContext, shiftMs: number): Promise<void> {
  await setServerClock(context, shiftMs);
  await context.clock.install({ time: Date.now() + shiftMs });
}

/** Has the app add `shiftMs` to its clock for the calls this browser context makes. */
export async function setServerClock(context: BrowserContext, shiftMs: number): Promise<void> {
  const url = test.info().project.use.baseURL;
  if (url === undefined) throw new Error('the project has no base address');
  await context.addCookies([{ name: TEST_CLOCK_COOKIE, value: String(shiftMs), url }]);
}
