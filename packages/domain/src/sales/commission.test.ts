import { describe, expect, it } from 'vitest';
import { commissionAmount, type CommissionFacts } from './commission';

const base: CommissionFacts = {
  basis: 'fixed',
  rate: '500.00',
  taxableValue: '60855.00',
  kw: 3.24,
  hp: 7.5,
};

describe('commissionAmount (CRM-09, CRM-5)', () => {
  it.each<[string, Partial<CommissionFacts>, string | null, string | null]>([
    ['a fixed commission is the rate itself', {}, '1.000', '500.00'],
    [
      'a percentage of the taxable value',
      { basis: 'percent', rate: '2.50' },
      '60855.000',
      '1521.38',
    ],
    [
      'a percentage rounds half-up to the paisa',
      { basis: 'percent', rate: '1.00', taxableValue: '0.50' },
      '0.500',
      '0.01',
    ],
    [
      'a percentage of nothing is nothing',
      { basis: 'percent', rate: '5.00', taxableValue: '0.00' },
      '0.000',
      '0.00',
    ],
    ['per kW of the lead’s sizing', { basis: 'per_kw', rate: '1000.00' }, '3.240', '3240.00'],
    ['per kW rounds half-up', { basis: 'per_kw', rate: '0.05', kw: 0.1 }, '0.100', '0.01'],
    ['per HP of the lead’s sizing', { basis: 'per_hp', rate: '250.50' }, '7.500', '1878.75'],
    ['per kW with no sizing records nothing', { basis: 'per_kw', kw: null }, null, null],
    ['per HP with no pump sizing records nothing', { basis: 'per_hp', hp: null }, null, null],
    ['a size of zero records nothing', { basis: 'per_kw', kw: 0 }, null, null],
  ])('%s', (_label, over, measure, amount) => {
    const result = commissionAmount({ ...base, ...over });
    if (measure === null) expect(result).toBeNull();
    else expect(result).toEqual({ measure, amount });
  });

  it('keeps the amount within numeric(14,2) for the largest order a quote holds', () => {
    expect(
      commissionAmount({
        ...base,
        basis: 'percent',
        rate: '100.00',
        taxableValue: '999999999999.99',
      }),
    ).toEqual({ measure: '999999999999.990', amount: '999999999999.99' });
  });
});
