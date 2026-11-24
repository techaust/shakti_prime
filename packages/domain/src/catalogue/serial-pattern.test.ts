import { describe, expect, it } from 'vitest';
import { serialMatchesPattern, serialsOutsidePattern } from './serial-pattern';

describe('serialMatchesPattern', () => {
  it('takes a serial that fits the item pattern whole, and any serial with no pattern', () => {
    const item = { serialPattern: 'SP[0-9]{8}' };
    expect(serialMatchesPattern(item, 'SP00001234')).toBe(true);
    expect(serialMatchesPattern(item, 'SP0000123')).toBe(false);
    expect(serialMatchesPattern(item, '8901234567890')).toBe(false);
    expect(serialMatchesPattern({ serialPattern: null }, '8901234567890')).toBe(true);
  });
});

describe('serialsOutsidePattern', () => {
  it('lists the existing serials a new pattern would not take, in order', () => {
    expect(serialsOutsidePattern('SP[0-9]{4}', ['SP0001', 'X1', 'SP0002', 'SP12'])).toEqual([
      'X1',
      'SP12',
    ]);
    expect(serialsOutsidePattern(null, ['anything'])).toEqual([]);
    expect(serialsOutsidePattern('SP[0-9]{4}', [])).toEqual([]);
  });
});
