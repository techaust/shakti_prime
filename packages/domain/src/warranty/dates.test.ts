import { describe, expect, it } from 'vitest';
import { parseSheetDate, warrantyUntilFrom } from './dates';

describe('parseSheetDate', () => {
  it.each([
    ['10-03-2026', '2026-03-10'],
    ['1/3/2026', '2026-03-01'],
    ['29.02.2028', '2028-02-29'],
    ['2026-03-10', '2026-03-10'],
    [' 2026-12-31 ', '2026-12-31'],
  ])('reads %s', (text, iso) => {
    expect(parseSheetDate(text)).toBe(iso);
  });

  it.each(['31-02-2026', '29-02-2027', '2026-13-01', '10-03-26', 'March 2026', '', '00-01-2026'])(
    'refuses %s',
    (text) => {
      expect(parseSheetDate(text)).toBeUndefined();
    },
  );
});

describe('warrantyUntilFrom', () => {
  it.each([
    ['2026-03-10', 12, '2027-03-09'],
    ['2026-03-10', 0, '2026-03-09'],
    ['2026-01-31', 1, '2026-02-27'],
    ['2028-01-31', 1, '2028-02-28'],
    ['2026-11-15', 3, '2027-02-14'],
    ['2026-03-01', 60, '2031-02-28'],
    ['2027-12-31', 24, '2029-12-30'],
  ])('from %s for %i months runs to %s', (from, months, until) => {
    expect(warrantyUntilFrom(from, months)).toBe(until);
  });

  it('refuses a date that is not YYYY-MM-DD or months that are not whole', () => {
    expect(() => warrantyUntilFrom('10-03-2026', 12)).toThrow(RangeError);
    expect(() => warrantyUntilFrom('2026-03-10', 1.5)).toThrow(RangeError);
    expect(() => warrantyUntilFrom('2026-03-10', -1)).toThrow(RangeError);
  });
});
