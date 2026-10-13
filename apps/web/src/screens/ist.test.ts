import { IST_OFFSET_MS as DOMAIN_OFFSET, istCalendarDate } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { IST_OFFSET_MS, istDay } from './ist';

describe("the web app's India day", () => {
  it('is the domain’s, on both sides of midnight in India and across a year', () => {
    expect(IST_OFFSET_MS).toBe(DOMAIN_OFFSET);
    for (const at of [
      '2026-10-09T18:29:59.999Z',
      '2026-10-09T18:30:00.000Z',
      '2026-12-31T18:29:59.999Z',
      '2026-12-31T18:30:00.000Z',
      '2027-03-31T18:30:00.000Z',
    ]) {
      expect(istDay(new Date(at))).toBe(istCalendarDate(new Date(at)));
    }
    expect(istDay(new Date('2026-10-09T18:30:00.000Z'))).toBe('2026-10-10');
  });
});
