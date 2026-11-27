import { describe, expect, it } from 'vitest';
import { milestoneOpen, percentTotal, stepKeys, twoDecimals } from './finance';

describe('payment terms on screen', () => {
  it('keys each payment by its name, uniquely, as the terms keep them', () => {
    expect(stepKeys(['Advance', 'Balance', 'Balance'])).toEqual([
      'advance',
      'balance',
      'balance_2',
    ]);
    expect(stepKeys(['Before the material leaves', '50% booking', ''])).toEqual([
      'before_the_material_leaves',
      'booking',
      'payment_3',
    ]);
    for (const key of stepKeys(['Ãdvance!', '2nd part'])) {
      expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    }
  });

  it('adds the percentages in hundredths, so 33.33 + 33.33 + 33.34 is exactly 100', () => {
    expect(percentTotal(['33.33', '33.33', '33.34'])).toBe(10000);
    expect(percentTotal(['50', 'x', ''])).toBe(5000);
  });

  it('writes a typed figure with two decimals, or refuses it', () => {
    expect(twoDecimals('50')).toBe('50.00');
    expect(twoDecimals('5,000.5')).toBe('5000.50');
    expect(twoDecimals('1.234')).toBeNull();
    expect(twoDecimals('-1')).toBeNull();
  });

  it('lets only a payment still waiting for money be waived', () => {
    expect(
      ['pending', 'due', 'part_paid', 'paid', 'waived'].map((s) => milestoneOpen(s as 'due')),
    ).toEqual([true, true, true, false, false]);
  });
});
