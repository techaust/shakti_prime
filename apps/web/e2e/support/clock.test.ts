import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  callingHoursShift,
  INSIDE_CALLING_HOURS_MINUTE,
  OUTSIDE_CALLING_HOURS_MINUTE,
  runStart,
  shiftToIstMinute,
} from './clock';

const IST_OFFSET_MS = 330 * 60_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Minutes since midnight in India. */
function istMinute(at: number): number {
  return Math.floor(((((at + IST_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000) / MINUTE_MS);
}

describe('the run’s start (runStart)', () => {
  const folders: string[] = [];
  const folder = () => {
    const made = mkdtempSync(join(tmpdir(), 'calling-hours-'));
    folders.push(made);
    return made;
  };
  afterEach(() => {
    for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true });
  });

  it('is the first asker’s moment for every later worker and retry of the run', () => {
    const out = join(folder(), 'test-results');
    const first = Date.UTC(2031, 0, 15, 3, 0, 17);
    expect(runStart(out, first)).toBe(first);
    expect(runStart(out, first + 90_000)).toBe(first);
    expect(runStart(out, first + 3 * HOUR_MS)).toBe(first);
  });

  it('starts afresh from a folder kept from a run four hours old, or from an unreadable one', () => {
    const out = folder();
    const first = Date.UTC(2031, 0, 15, 3, 0, 17);
    runStart(out, first);
    const later = first + 4 * HOUR_MS;
    expect(runStart(out, later)).toBe(later);
    expect(runStart(out, later + MINUTE_MS)).toBe(later);
    const spoilt = folder();
    writeFileSync(join(spoilt, 'calling-hours-run-start'), '');
    expect(runStart(spoilt, first)).toBe(first);
    expect(runStart(spoilt, first + MINUTE_MS)).toBe(first);
  });
});

describe('the run’s lines on each side of the hours (callingHoursShift)', () => {
  it('holds each side of the hours for four hours of a run, whatever the hour it started', () => {
    const begin = Date.UTC(2031, 0, 15, 0, 0, 17);
    for (let start = begin; start < begin + 2 * 86_400_000; start += 7 * MINUTE_MS) {
      const inside = callingHoursShift('inside', start);
      const outside = callingHoursShift('outside', start);
      for (const shift of [inside, outside]) {
        expect(shift).toBeGreaterThan(0);
        expect(shift).toBeLessThanOrEqual(86_400_000);
      }
      for (const later of [0, HOUR_MS, 4 * HOUR_MS - 1]) {
        const m = istMinute(start + inside + later);
        expect(m >= 9 * 60 && m < 21 * 60, new Date(start).toISOString()).toBe(true);
        const o = istMinute(start + outside + later);
        expect(o < 9 * 60 || o >= 21 * 60, new Date(start).toISOString()).toBe(true);
      }
    }
  });

  it('is one shift for the whole run, so its moved clock runs forward from test to test', () => {
    const start = Date.UTC(2031, 0, 15, 15, 40, 0);
    const shift = callingHoursShift('inside', start);
    // A test, then a retry of it twenty minutes on: the second starts later on the moved clock,
    // where a shift taken again from each test's own moment would start both at 11 AM.
    const first = start + 5 * MINUTE_MS + shift;
    const retry = start + 25 * MINUTE_MS + shift;
    expect(retry - first).toBe(20 * MINUTE_MS);
    expect(new Date(start + shift)).toEqual(new Date('2031-01-16T11:00:00+05:30'));
  });
});

describe('the journeys’ moved clocks (shiftToIstMinute)', () => {
  /** A wall-clock time on 28-11-2026 in India. */
  const wall = (hhmmss: string) => new Date(`2026-11-28T${hhmmss}+05:30`);

  it.each([
    // The edges the click-to-dial journeys failed across, and the minute itself.
    ['09:10:00', '2026-11-28T11:00:00+05:30', '2026-11-28T22:00:00+05:30'],
    ['09:20:00', '2026-11-28T11:00:00+05:30', '2026-11-28T22:00:00+05:30'],
    ['20:30:00', '2026-11-29T11:00:00+05:30', '2026-11-28T22:00:00+05:30'],
    ['21:05:00', '2026-11-29T11:00:00+05:30', '2026-11-28T22:00:00+05:30'],
    ['11:00:00', '2026-11-29T11:00:00+05:30', '2026-11-28T22:00:00+05:30'],
    ['22:00:30', '2026-11-29T11:00:00+05:30', '2026-11-29T22:00:00+05:30'],
  ])('from %s IST moves the server to %s inside and %s outside', (now, inside, outside) => {
    const at = wall(now);
    expect(new Date(at.getTime() + shiftToIstMinute(INSIDE_CALLING_HOURS_MINUTE, at))).toEqual(
      new Date(inside),
    );
    expect(new Date(at.getTime() + shiftToIstMinute(OUTSIDE_CALLING_HOURS_MINUTE, at))).toEqual(
      new Date(outside),
    );
  });

  it('always moves forward, by less than a day, onto the same side of the hours', () => {
    const start = Date.UTC(2031, 0, 15, 0, 0, 17);
    for (let at = start; at < start + 2 * 86_400_000; at += 7 * MINUTE_MS) {
      for (const [minute, inHours] of [
        [INSIDE_CALLING_HOURS_MINUTE, true],
        [OUTSIDE_CALLING_HOURS_MINUTE, false],
      ] as const) {
        const shift = shiftToIstMinute(minute, new Date(at));
        expect(shift).toBeGreaterThan(0);
        expect(shift).toBeLessThanOrEqual(86_400_000);
        // Inside or outside for the next half hour of the journey.
        for (const later of [0, 10 * MINUTE_MS, 30 * MINUTE_MS]) {
          const m = istMinute(at + shift + later);
          expect(m >= 9 * 60 && m < 21 * 60, new Date(at).toISOString()).toBe(inHours);
        }
      }
    }
  });

  it('keeps the callback the moved browser proposes (10 AM the next day) ahead of the moved server', () => {
    const at = wall('20:45:00');
    const moved = at.getTime() + shiftToIstMinute(INSIDE_CALLING_HOURS_MINUTE, at);
    // The browser's clock is moved with the server's (setClocks), so it proposes from `moved`.
    const nextDay = Math.floor((moved + IST_OFFSET_MS) / 86_400_000) + 1;
    const proposed = nextDay * 86_400_000 + 10 * 3_600_000 - IST_OFFSET_MS;
    expect(proposed - moved).toBe(23 * 3_600_000);
  });
});
