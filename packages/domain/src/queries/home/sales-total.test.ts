import { describe, expect, it } from 'vitest';
import { salesGroupTotal } from './home';

const company = (entityId: number, ordersValue: string, counts = 1) => ({
  entityId,
  quotesSent: counts,
  quotesAccepted: counts,
  ordersConfirmed: counts,
  ordersValue,
});

describe('salesGroupTotal', () => {
  it('adds every figure of the companies, the order value to the paisa', () => {
    expect(
      salesGroupTotal([company(1, '1000.50', 2), company(2, '2000.25', 3), company(3, '0.01')]),
    ).toEqual({
      quotesSent: 6,
      quotesAccepted: 6,
      ordersConfirmed: 6,
      ordersValue: '3000.76',
    });
  });

  it('keeps amounts a floating-point sum would round wrongly exact', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004; in paise it is 30.
    expect(salesGroupTotal([company(1, '0.10'), company(2, '0.20')]).ordersValue).toBe('0.30');
    expect(salesGroupTotal([company(1, '99999999998.99'), company(2, '1.01')]).ordersValue).toBe(
      '100000000000.00',
    );
  });

  it('is zero with no company', () => {
    expect(salesGroupTotal([])).toEqual({
      quotesSent: 0,
      quotesAccepted: 0,
      ordersConfirmed: 0,
      ordersValue: '0.00',
    });
  });
});
