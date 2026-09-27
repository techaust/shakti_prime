import { describe, expect, it } from 'vitest';
import { formatDmy, maskDmy, parseDmy } from './date';

describe('DD-MM-YYYY dates', () => {
  it('reads a real calendar date into the ISO form', () => {
    expect(parseDmy('27-09-2026')).toBe('2026-09-27');
    expect(parseDmy(' 01-01-2027 ')).toBe('2027-01-01');
    expect(parseDmy('29-02-2028')).toBe('2028-02-29');
  });

  it('refuses dates that do not exist and other shapes', () => {
    expect(parseDmy('29-02-2027')).toBeUndefined();
    expect(parseDmy('31-04-2026')).toBeUndefined();
    expect(parseDmy('00-01-2026')).toBeUndefined();
    expect(parseDmy('12-13-2026')).toBeUndefined();
    expect(parseDmy('2026-09-27')).toBeUndefined();
    expect(parseDmy('27/09/2026')).toBeUndefined();
    expect(parseDmy('')).toBeUndefined();
  });

  it('shows an ISO date the Indian way and nothing for anything else', () => {
    expect(formatDmy('2026-09-27')).toBe('27-09-2026');
    expect(formatDmy(undefined)).toBe('');
    expect(formatDmy('27-09-2026')).toBe('');
  });

  it('puts the dashes in while a person types', () => {
    expect(maskDmy('2')).toBe('2');
    expect(maskDmy('270')).toBe('27-0');
    expect(maskDmy('2709')).toBe('27-09');
    expect(maskDmy('27092026')).toBe('27-09-2026');
    expect(maskDmy('27-09-20261')).toBe('27-09-2026');
    expect(maskDmy('27/09/2026')).toBe('27-09-2026');
  });

  it('round-trips', () => {
    expect(parseDmy(formatDmy('2031-12-31'))).toBe('2031-12-31');
  });
});
