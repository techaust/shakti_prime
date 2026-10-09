import { describe, expect, it } from 'vitest';
import {
  isPeriodStart,
  periodBounds,
  periodEndOn,
  periodStartOn,
  progressFraction,
} from './targets';

// 2026-10-09 is a Friday. 18:29 UTC is 23:59 IST the same day; 18:30 UTC is midnight IST after.
const FRIDAY_LATE = new Date('2026-10-09T18:29:59.999Z');
const SATURDAY_FIRST = new Date('2026-10-09T18:30:00.000Z');

describe('periodStartOn', () => {
  it('names the IST day, week (Monday) and month of an instant', () => {
    expect(periodStartOn('day', FRIDAY_LATE)).toBe('2026-10-09');
    expect(periodStartOn('week', FRIDAY_LATE)).toBe('2026-10-05');
    expect(periodStartOn('month', FRIDAY_LATE)).toBe('2026-10-01');
  });

  it('moves to the next IST day at 18:30 UTC', () => {
    expect(periodStartOn('day', SATURDAY_FIRST)).toBe('2026-10-10');
    expect(periodStartOn('week', SATURDAY_FIRST)).toBe('2026-10-05');
  });

  it('puts a Sunday in the week of the Monday before it', () => {
    expect(periodStartOn('week', new Date('2026-10-11T05:00:00Z'))).toBe('2026-10-05');
    expect(periodStartOn('week', new Date('2026-10-12T05:00:00Z'))).toBe('2026-10-12');
  });

  it('starts a month on the 1st in IST, not UTC', () => {
    // 20:00 UTC on 30 Sept is 01:30 IST on 1 Oct.
    expect(periodStartOn('month', new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    expect(periodStartOn('month', new Date('2026-09-30T18:29:00Z'))).toBe('2026-09-01');
  });

  it('crosses a year', () => {
    expect(periodStartOn('week', new Date('2027-01-01T05:00:00Z'))).toBe('2026-12-28');
    expect(periodStartOn('month', new Date('2027-01-15T05:00:00Z'))).toBe('2027-01-01');
  });
});

describe('isPeriodStart', () => {
  it('accepts any day, a Monday and the 1st, and nothing else', () => {
    expect(isPeriodStart('day', '2026-10-09')).toBe(true);
    expect(isPeriodStart('week', '2026-10-05')).toBe(true);
    expect(isPeriodStart('week', '2026-10-06')).toBe(false);
    expect(isPeriodStart('month', '2026-10-01')).toBe(true);
    expect(isPeriodStart('month', '2026-10-02')).toBe(false);
  });

  it('refuses a date that does not exist', () => {
    expect(isPeriodStart('day', '2026-02-30')).toBe(false);
    expect(isPeriodStart('day', 'tomorrow')).toBe(false);
  });
});

describe('periodEndOn and periodBounds', () => {
  it('ends a day on itself, a week on Sunday and a month on its last day', () => {
    expect(periodEndOn('day', '2026-10-09')).toBe('2026-10-09');
    expect(periodEndOn('week', '2026-10-05')).toBe('2026-10-11');
    expect(periodEndOn('month', '2026-10-01')).toBe('2026-10-31');
    expect(periodEndOn('month', '2026-02-01')).toBe('2026-02-28');
    expect(periodEndOn('month', '2028-02-01')).toBe('2028-02-29');
    expect(periodEndOn('month', '2026-12-01')).toBe('2026-12-31');
  });

  it('covers midnight IST to midnight IST, the end not included', () => {
    const day = periodBounds('day', '2026-10-09');
    expect(day.from.toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(day.to.toISOString()).toBe('2026-10-09T18:30:00.000Z');
    const week = periodBounds('week', '2026-10-05');
    expect(week.to.getTime() - week.from.getTime()).toBe(7 * 86_400_000);
    const month = periodBounds('month', '2026-10-01');
    expect(month.to.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('holds the last millisecond of the period and not the first of the next', () => {
    const { from, to } = periodBounds('day', '2026-10-09');
    expect(FRIDAY_LATE >= from && FRIDAY_LATE < to).toBe(true);
    expect(SATURDAY_FIRST >= from && SATURDAY_FIRST < to).toBe(false);
  });
});

describe('progressFraction', () => {
  it('is the actual over the target', () => {
    expect(progressFraction(15, 30)).toBe(0.5);
    expect(progressFraction(30, 30)).toBe(1);
    expect(progressFraction(45, 30)).toBe(1.5);
    expect(progressFraction(0, 30)).toBe(0);
  });

  it('is null with no target, and for a target of 0', () => {
    expect(progressFraction(10, null)).toBeNull();
    expect(progressFraction(10, 0)).toBeNull();
  });

  it('never goes below 0 or turns not-a-number', () => {
    expect(progressFraction(-3, 10)).toBe(0);
    expect(progressFraction(Number.NaN, 10)).toBe(0);
  });
});
