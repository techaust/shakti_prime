import { describe, expect, it } from 'vitest';
import { formatAmount, formatDate, formatRupees, groupIndian } from './format';

describe('groupIndian', () => {
  it('groups the last three digits, then pairs', () => {
    expect(groupIndian('0')).toBe('0');
    expect(groupIndian('999')).toBe('999');
    expect(groupIndian('1000')).toBe('1,000');
    expect(groupIndian('100000')).toBe('1,00,000');
    expect(groupIndian('1234567')).toBe('12,34,567');
    expect(groupIndian('123456789')).toBe('12,34,56,789');
    expect(groupIndian('9876543210123')).toBe('98,76,54,32,10,123');
  });
});

describe('formatRupees', () => {
  it('shows rupees with lakh and crore grouping and paise', () => {
    expect(formatRupees('1234567.5')).toBe('₹12,34,567.50');
    expect(formatRupees('120000')).toBe('₹1,20,000.00');
    expect(formatRupees('10000000.00')).toBe('₹1,00,00,000.00');
    expect(formatRupees('0.40')).toBe('₹0.40');
    expect(formatRupees('-0.40')).toBe('-₹0.40');
    expect(formatRupees('007.05')).toBe('₹7.05');
  });

  it('keeps the digits exactly as given, with no rounding', () => {
    expect(formatRupees('99999999999.99')).toBe('₹99,99,99,99,999.99');
  });

  it('refuses anything that is not a money string', () => {
    expect(() => formatRupees('12.345')).toThrow(RangeError);
    expect(() => formatRupees('1,000')).toThrow(RangeError);
    expect(() => formatRupees('')).toThrow(RangeError);
  });

  it('formats a table amount without the sign', () => {
    expect(formatAmount('1425000.00')).toBe('14,25,000.00');
  });
});

describe('formatDate', () => {
  it('writes a calendar date as DD-MM-YYYY', () => {
    expect(formatDate('2026-09-27')).toBe('27-09-2026');
  });

  it('writes an instant as its IST date', () => {
    // 20:00 UTC is already the next day in India.
    expect(formatDate(new Date('2026-03-31T20:00:00Z'))).toBe('01-04-2026');
    expect(formatDate('2026-03-31T18:00:00Z')).toBe('31-03-2026');
  });

  it('refuses a value that is not a date', () => {
    expect(() => formatDate('next week')).toThrow(RangeError);
  });
});
