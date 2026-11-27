import { describe, expect, it } from 'vitest';
import { countLeaveDays, datesBetween, isCalendarDate, isoWeekday, spanDays } from './leave-days';

describe('leave days', () => {
  it('names the ISO day of the week', () => {
    expect(isoWeekday('2026-11-23')).toBe(1); // a Monday
    expect(isoWeekday('2026-11-29')).toBe(7); // a Sunday
    expect(isoWeekday('1970-01-01')).toBe(4);
    expect(isoWeekday('1969-12-29')).toBe(1);
  });

  it('knows a real calendar date', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('26-11-2026')).toBe(false);
  });

  it('counts a span with both ends, across a month and a year', () => {
    expect(spanDays('2026-11-27', '2026-11-27')).toBe(1);
    expect(spanDays('2026-12-30', '2027-01-02')).toBe(4);
    expect(spanDays('2026-12-02', '2026-12-01')).toBe(0);
    expect(datesBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(datesBetween('2026-12-02', '2026-12-01')).toEqual([]);
  });

  it('leaves out the weekly days off and the holidays', () => {
    // Monday 23-11-2026 to Sunday 29-11-2026, Sunday off, Wednesday a holiday.
    const span = { fromDate: '2026-11-23', toDate: '2026-11-29' };
    expect(countLeaveDays({ ...span, weeklyOffDays: [], holidays: new Set() })).toBe(7);
    expect(countLeaveDays({ ...span, weeklyOffDays: [7], holidays: new Set() })).toBe(6);
    expect(countLeaveDays({ ...span, weeklyOffDays: [7], holidays: new Set(['2026-11-25']) })).toBe(
      5,
    );
    // A holiday on a day off counts once.
    expect(countLeaveDays({ ...span, weeklyOffDays: [7], holidays: new Set(['2026-11-29']) })).toBe(
      6,
    );
  });

  it('answers 0 for a span of days off only', () => {
    expect(
      countLeaveDays({
        fromDate: '2026-11-28',
        toDate: '2026-11-29',
        weeklyOffDays: [6, 7],
        holidays: new Set(),
      }),
    ).toBe(0);
  });
});
