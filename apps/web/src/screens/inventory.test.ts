import { describe, expect, it } from 'vitest';
import {
  formatQty,
  istDate,
  quantityFromTyped,
  rupeesOfRate,
  serialHref,
  serialsFromTyped,
  stockCardHref,
} from './inventory';

describe('stock screens', () => {
  it('show a quantity with lakh grouping and no trailing zeros', () => {
    expect(formatQty('0.000')).toBe('0');
    expect(formatQty('12.500')).toBe('12.5');
    expect(formatQty('1234567.125')).toBe('12,34,567.125');
  });

  it('take a typed quantity above zero with up to three decimals', () => {
    expect(quantityFromTyped(' 12.5 ')).toBe('12.5');
    expect(quantityFromTyped('1,000')).toBe('1000');
    expect(quantityFromTyped('0')).toBeUndefined();
    expect(quantityFromTyped('1.2345')).toBeUndefined();
    expect(quantityFromTyped('-1')).toBeUndefined();
    expect(quantityFromTyped('ten')).toBeUndefined();
  });

  it('take serials one per line, each once in any case', () => {
    expect(serialsFromTyped(' A1 \n\nb2\r\n')).toEqual(['A1', 'b2']);
    expect(serialsFromTyped('A1\na1')).toBeUndefined();
    expect(serialsFromTyped('  \n ')).toBeUndefined();
    expect(serialsFromTyped('x'.repeat(101))).toBeUndefined();
  });

  it('round a unit cost to paise, half up', () => {
    expect(rupeesOfRate('42.3456')).toBe('42.35');
    expect(rupeesOfRate('42.3449')).toBe('42.34');
    expect(rupeesOfRate('0.0050')).toBe('0.01');
    expect(rupeesOfRate('99.9950')).toBe('100.00');
  });

  it('link the stock card and a serial in their company', () => {
    expect(stockCardHref(2, 'abc')).toBe('/inventory/stock/2/abc');
    expect(serialHref(3, 'def')).toBe('/inventory/serials/def?company=3');
  });

  it('read today in India', () => {
    expect(istDate(new Date('2026-11-23T19:00:00Z'))).toBe('2026-11-24');
    expect(istDate(new Date('2026-11-23T18:00:00Z'))).toBe('2026-11-23');
  });
});
