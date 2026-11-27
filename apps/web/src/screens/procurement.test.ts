import { describe, expect, it } from 'vitest';
import { formatQuantity, formatRate, rateFromTyped } from './procurement';

describe('procurement formats', () => {
  it('shows a rate with two decimals, and four only when they count', () => {
    expect(formatRate('41.5000')).toBe('₹41.50');
    expect(formatRate('12.3456')).toBe('₹12.3456');
    expect(formatRate('12.3400')).toBe('₹12.34');
    expect(formatRate('12.3450')).toBe('₹12.345');
    expect(formatRate('1234567.0000')).toBe('₹12,34,567.00');
    expect(() => formatRate('12.5')).toThrow(RangeError);
  });

  it('shows a quantity without trailing zeros', () => {
    expect(formatQuantity('500.000')).toBe('500');
    expect(formatQuantity('12500.250')).toBe('12,500.25');
  });

  it('reads a typed rate, refusing nought and more than four decimals', () => {
    expect(rateFromTyped('₹ 1,250.5')).toBe('1250.5');
    expect(rateFromTyped('0')).toBeUndefined();
    expect(rateFromTyped('1.23456')).toBeUndefined();
    expect(rateFromTyped('abc')).toBeUndefined();
  });
});
