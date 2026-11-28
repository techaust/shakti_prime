import { describe, expect, it } from 'vitest';
import { costLineAmount, costTotal, quantityText } from './cost-amount';

describe('costLineAmount', () => {
  it.each([
    ['1', '850.00', '1.000', '850.00'],
    ['2.5', '1200.00', '2.500', '3000.00'],
    ['0.333', '10.00', '0.333', '3.33'],
    // 0.005 of a rupee rounds up to the paisa
    ['0.5', '0.01', '0.500', '0.01'],
    ['0.4', '0.01', '0.400', '0.00'],
    ['3.125', '99.99', '3.125', '312.47'],
  ])('%s at %s is %s for %s', (quantity, rate, stored, amount) => {
    expect(costLineAmount(quantity, rate)).toEqual({ quantity: stored, amount });
  });

  it('refuses an amount beyond what the column holds', () => {
    expect(() => costLineAmount('999999999', '999999999999.99')).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});

describe('quantityText', () => {
  it('writes three decimals with the sign', () => {
    expect(quantityText(2500n)).toBe('2.500');
    expect(quantityText(-7n)).toBe('-0.007');
  });
});

describe('costTotal', () => {
  it('adds charges and their reversals', () => {
    expect(costTotal(['3000.00', '850.00', '-3000.00'])).toBe('850.00');
    expect(costTotal([])).toBe('0.00');
  });
});
