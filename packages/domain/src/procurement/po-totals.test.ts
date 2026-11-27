import { describe, expect, it } from 'vitest';
import { poLineAmount, purchaseOrderTotals, stockUnitCost } from './po-totals';

const RATE_ID = '01990000-0000-7000-8000-0000000000aa';

describe('poLineAmount', () => {
  it('multiplies the quantity by the rate and rounds half-up to the paisa', () => {
    expect(poLineAmount('10', '125.5')).toBe('1255.00');
    expect(poLineAmount('3', '0.3333')).toBe('1.00');
    // 2.5 × 12.3456 = 30.864 → 30.86; 1.005 × 1 = 1.005 → 1.01 (half-up).
    expect(poLineAmount('2.5', '12.3456')).toBe('30.86');
    expect(poLineAmount('1.005', '1')).toBe('1.01');
  });
});

describe('stockUnitCost', () => {
  it('divides a purchase rate by the stock units each purchase unit holds, to four decimals', () => {
    expect(stockUnitCost('1500', '1')).toBe('1500.0000');
    // A coil of 100 metres at ₹2,345.67: ₹23.4567 a metre.
    expect(stockUnitCost('2345.67', '100')).toBe('23.4567');
    expect(stockUnitCost('10', '3')).toBe('3.3333');
    expect(stockUnitCost('20', '3')).toBe('6.6667');
  });
});

describe('purchaseOrderTotals', () => {
  const line = (amount: string | null, taxRatePct: string | null = '18.00') => ({
    amount,
    taxRatePct,
    taxRateId: taxRatePct === null ? null : RATE_ID,
  });

  it('splits CGST and SGST when the vendor is in the state the goods go to', () => {
    expect(
      purchaseOrderTotals([line('1000.00'), line('500.00', '5.00')], {
        vendorStateCode: '08',
        placeOfSupplyStateCode: '08',
      }),
    ).toEqual({
      subtotal: '1500.00',
      cgst: '102.50',
      sgst: '102.50',
      igst: '0.00',
      taxTotal: '205.00',
      roundOff: '0.00',
      grandTotal: '1705.00',
    });
  });

  it('charges IGST across states and rounds the grand total to the rupee', () => {
    expect(
      purchaseOrderTotals([line('999.99')], { vendorStateCode: '27', placeOfSupplyStateCode: '08' }),
    ).toEqual({
      subtotal: '999.99',
      cgst: '0.00',
      sgst: '0.00',
      igst: '180.00',
      taxTotal: '180.00',
      roundOff: '0.01',
      grandTotal: '1180.00',
    });
  });

  it('takes an unregistered vendor as within the state', () => {
    const totals = purchaseOrderTotals([line('100.00')], {
      vendorStateCode: null,
      placeOfSupplyStateCode: '08',
    });
    expect(totals?.cgst).toBe('9.00');
    expect(totals?.igst).toBe('0.00');
  });

  it('answers nothing while a line has no rate or no GST rate, or there is no line', () => {
    const parties = { vendorStateCode: '08', placeOfSupplyStateCode: '08' };
    expect(purchaseOrderTotals([line('1.00'), line(null)], parties)).toBeNull();
    expect(purchaseOrderTotals([line('1.00', null)], parties)).toBeNull();
    expect(purchaseOrderTotals([], parties)).toBeNull();
  });
});
