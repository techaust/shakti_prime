import { describe, expect, it } from 'vitest';
import {
  insideCallingHours,
  INSIDE_CALLING_HOURS_MINUTE,
  outsideCallingHours,
  OUTSIDE_CALLING_HOURS_MINUTE,
  shiftToIstMinute,
} from './clock';

const IST_OFFSET_MS = 330 * 60_000;
const MINUTE_MS = 60_000;

/** Minutes since midnight in India. */
function istMinute(at: number): number {
  return Math.floor(((((at + IST_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000) / MINUTE_MS);
}

describe('the journeys’ calling-hours clock', () => {
  it('puts the server inside the hours for the next ten minutes, whatever the wall clock says', () => {
    const start = Date.UTC(2031, 0, 15, 0, 0, 17);
    for (let at = start; at < start + 2 * 86_400_000; at += 7 * MINUTE_MS) {
      const shift = insideCallingHours(new Date(at));
      expect(shift).toBeGreaterThanOrEqual(0);
      for (const later of [0, 5 * MINUTE_MS, 10 * MINUTE_MS]) {
        const minute = istMinute(at + shift + later);
        expect(
          minute,
          `at ${new Date(at).toISOString()} + ${String(later)}`,
        ).toBeGreaterThanOrEqual(9 * 60);
        expect(minute).toBeLessThan(21 * 60);
      }
    }
  });

  it('puts the server outside the hours for the next ten minutes, whatever the wall clock says', () => {
    const start = Date.UTC(2031, 0, 15, 0, 0, 17);
    for (let at = start; at < start + 2 * 86_400_000; at += 7 * MINUTE_MS) {
      const shift = outsideCallingHours(new Date(at));
      expect(shift).toBeGreaterThanOrEqual(0);
      for (const later of [0, 5 * MINUTE_MS, 10 * MINUTE_MS]) {
        const minute = istMinute(at + shift + later);
        expect(minute < 9 * 60 || minute >= 21 * 60, `at ${new Date(at).toISOString()}`).toBe(true);
      }
    }
  });

  it('keeps an inside shift short enough that the proposed callback is still ahead', () => {
    // The workspace proposes 10 AM on the next day of the wall clock.
    const start = Date.UTC(2031, 0, 15, 0, 0, 0);
    for (let at = start; at < start + 86_400_000; at += 13 * MINUTE_MS) {
      const shifted = at + insideCallingHours(new Date(at));
      const nextDay = Math.floor((at + IST_OFFSET_MS) / 86_400_000) + 1;
      const proposed = nextDay * 86_400_000 + 10 * 3_600_000 - IST_OFFSET_MS;
      expect(proposed - shifted).toBeGreaterThan(20 * MINUTE_MS);
    }
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
