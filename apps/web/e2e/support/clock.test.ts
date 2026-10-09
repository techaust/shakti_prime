import { describe, expect, it } from 'vitest';
import { insideCallingHours, outsideCallingHours } from './clock';

const IST_OFFSET_MS = 330 * 60_000;
const MINUTE_MS = 60_000;

/** Minutes since midnight in India. */
function istMinute(at: number): number {
  return Math.floor((((at + IST_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000 / MINUTE_MS);
}

describe('the journeys’ calling-hours clock', () => {
  it('puts the server inside the hours for the next ten minutes, whatever the wall clock says', () => {
    const start = Date.UTC(2031, 0, 15, 0, 0, 17);
    for (let at = start; at < start + 2 * 86_400_000; at += 7 * MINUTE_MS) {
      const shift = insideCallingHours(new Date(at));
      expect(shift).toBeGreaterThanOrEqual(0);
      for (const later of [0, 5 * MINUTE_MS, 10 * MINUTE_MS]) {
        const minute = istMinute(at + shift + later);
        expect(minute, `at ${new Date(at).toISOString()} + ${String(later)}`).toBeGreaterThanOrEqual(
          9 * 60,
        );
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
