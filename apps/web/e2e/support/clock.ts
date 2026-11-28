import type { BrowserContext } from '@playwright/test';
import { test } from '@playwright/test';
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The journeys' clocks for the calling hours (TRAI, 9 AM to 9 PM in India). The server's clock is
 * moved by a cookie that holds the milliseconds it adds to its own clock (`apps/web/src/test-clock.ts`);
 * only the app started by the journeys (`BOS_ENVIRONMENT=local` on this machine) honours it. The
 * browser's clock is moved with it (Playwright's clock), so the two agree as a caller's device and
 * the server do. Each side of the hours has one line for the whole run (`callingHours`): every
 * test, retry, project and file that moves its clocks inside the hours reads the same running
 * clock, so the calls a journey placed a moment before are never newer than its "now". The
 * outside line is another, later in the day; nothing is written on it, since outside the hours no
 * call is placed or saved.
 */
const TEST_CLOCK_COOKIE = 'bos-test-clock';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Minutes since midnight in India. */
function istMinute(at: Date): number {
  return Math.floor(((((at.getTime() + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS);
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

/** A side of the calling hours a journey moves its clocks to. */
export type CallingHoursSide = 'inside' | 'outside';

/** The file in a run's output folder that holds the moment the run started. */
const RUN_START_FILE = 'calling-hours-run-start';
/**
 * How long a run's start holds: a folder kept from an earlier run (Playwright's interface mode
 * keeps it) is started afresh after this, so the lines stay on their side of the hours, inside
 * from 11 AM to 3 PM and outside from 10 PM to 2 AM.
 */
const RUN_START_HOLDS_MS = 4 * HOUR_MS;

function readStart(file: string): number | undefined {
  try {
    const kept = Number(readFileSync(file, 'utf8'));
    return Number.isSafeInteger(kept) && kept > 0 ? kept : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The moment this run of the journeys started, the same for every worker, retry and project of
 * the run: the first to ask writes it into `folder`, the run's output folder, which Playwright
 * empties as each run starts. A file is never seen half written: it is written under a name of
 * its own, then linked (or, over a start that no longer holds, renamed) into place.
 */
export function runStart(folder: string, now = Date.now()): number {
  const file = join(folder, RUN_START_FILE);
  const kept = readStart(file);
  if (kept !== undefined && Math.abs(now - kept) < RUN_START_HOLDS_MS) return kept;
  mkdirSync(folder, { recursive: true });
  const draft = `${file}.${String(process.pid)}.${String(now)}`;
  writeFileSync(draft, String(now));
  try {
    if (kept === undefined) linkSync(draft, file);
    else renameSync(draft, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    // Another worker of the run wrote it first, and its start is the run's; a file that cannot
    // be read is no run's start, and is replaced.
    if (readStart(file) === undefined) renameSync(draft, file);
  } finally {
    rmSync(draft, { force: true });
  }
  return readStart(file) ?? now;
}

/**
 * The shift, in milliseconds, that puts the server on a side of the calling hours for a run that
 * started at `start`: 11 AM in India at the start, inside the hours, or 10 PM, outside them. It is
 * the same for the whole run, so the moved clock keeps running forward from that moment.
 */
export function callingHoursShift(side: CallingHoursSide, start: number): number {
  const minute = side === 'inside' ? INSIDE_CALLING_HOURS_MINUTE : OUTSIDE_CALLING_HOURS_MINUTE;
  return shiftToIstMinute(minute, new Date(start));
}

/** This run's shift for a side of the calling hours (`callingHoursShift`). */
export function callingHours(side: CallingHoursSide): number {
  return callingHoursShift(side, runStart(test.info().project.outputDir));
}

/** The contexts whose browser clock is Playwright's, which is installed once. */
const installed = new WeakSet<BrowserContext>();

/**
 * Moves both clocks of a browser context by `shiftMs`: the server's (the cookie) and the
 * browser's own (Playwright's clock, which keeps running in real time from the moved moment and
 * fires the page's timers as usual). The two then agree, as a caller's device and the server do,
 * so the screen reads the server's times against a clock that matches. The first move installs
 * the browser's clock, best before the context's first page opens; a later one sets it again.
 * `deviceAheadMs` sets the browser that much ahead of the server, as on a phone whose clock is
 * set wrong.
 */
export async function setClocks(
  context: BrowserContext,
  shiftMs: number,
  { deviceAheadMs = 0 }: { deviceAheadMs?: number } = {},
): Promise<void> {
  await setServerClock(context, shiftMs);
  const time = Date.now() + shiftMs + deviceAheadMs;
  if (installed.has(context)) {
    await context.clock.setSystemTime(time);
    return;
  }
  await context.clock.install({ time });
  installed.add(context);
}

/** Has the app add `shiftMs` to its clock for the calls this browser context makes. */
async function setServerClock(context: BrowserContext, shiftMs: number): Promise<void> {
  const url = test.info().project.use.baseURL;
  if (url === undefined) throw new Error('the project has no base address');
  await context.addCookies([{ name: TEST_CLOCK_COOKIE, value: String(shiftMs), url }]);
}
