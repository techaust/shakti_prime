import { describe, expect, it } from 'vitest';
import { withinCallingHours } from '../../telecom/dial-policy';
import { missedCallCallbackDue } from './inbound-calls';

// When a missed call's callback falls due (docs/03-roadmap-appendix/phase2.md §7.4): now inside
// calling hours (09:00 up to 21:00 IST), else at the next opening.
const at = (ist: string): Date => new Date(`${ist}+05:30`);

describe('missedCallCallbackDue', () => {
  it('is now inside calling hours, the first and last minutes included', () => {
    for (const ist of ['2026-11-17T09:00:00', '2026-11-17T13:27:45', '2026-11-17T20:59:59']) {
      expect(missedCallCallbackDue(at(ist))).toEqual(at(ist));
    }
  });

  it('is 09:00 the same day before calling hours', () => {
    expect(missedCallCallbackDue(at('2026-11-17T00:00:00'))).toEqual(at('2026-11-17T09:00:00'));
    expect(missedCallCallbackDue(at('2026-11-17T08:59:30'))).toEqual(at('2026-11-17T09:00:00'));
  });

  it('is 09:00 the next day from 21:00, across a month and a year', () => {
    expect(missedCallCallbackDue(at('2026-11-17T21:00:00'))).toEqual(at('2026-11-18T09:00:00'));
    expect(missedCallCallbackDue(at('2026-11-30T23:59:59'))).toEqual(at('2026-12-01T09:00:00'));
    expect(missedCallCallbackDue(at('2026-12-31T22:15:00'))).toEqual(at('2027-01-01T09:00:00'));
  });

  it('always falls inside calling hours', () => {
    for (let minute = 0; minute < 1440; minute += 7) {
      const now = new Date(at('2026-11-17T00:00:00').getTime() + minute * 60_000 + 13_000);
      const due = missedCallCallbackDue(now);
      expect(withinCallingHours(due)).toBe(true);
      expect(due.getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  });
});
