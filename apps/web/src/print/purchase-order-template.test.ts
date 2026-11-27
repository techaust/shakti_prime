// The purchase order PDF's structure (U2, review findings 3 and 10), without Chromium: printed only
// from its approval on and dated then, a cancelled order marked so, rates as the sheet shows them,
// the company's letterhead strip and logo, and no value at all for a reader without rates.
import type { PurchaseOrderDto, PurchaseOrderWithRatesDto } from '@shakti/contracts';
import type { PurchaseOrderPrintData } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import type { CompanyPrint } from './company';
import { renderPurchaseOrder } from './purchase-order-template';

const ID = '01a21e74-1abf-762f-8c91-ae74e2aa2280';
const PIXEL = { contentType: 'image/png' as const, base64: 'iVBORw0KGgo=' };

const company: CompanyPrint = {
  legalName: 'Shakti Supreme Private Limited',
  brandName: 'Shakti Supreme',
  addressLines: ['Plot 4, Industrial Area', 'Jaipur 302013'],
  gstin: '08AAACS1234A1Z5',
  logo: PIXEL,
  letterhead: PIXEL,
  bank: null,
};

function rated(state: PurchaseOrderWithRatesDto['state'], approvedAt: string | null) {
  const order: PurchaseOrderWithRatesDto = {
    id: ID,
    entityId: 1,
    poNo: 'SS/PO/2026-27/0007',
    vendorId: ID,
    vendorName: 'Mewar Cables',
    deliverToWarehouseId: ID,
    hubName: 'Jaipur hub',
    state,
    source: 'manual',
    expectedAt: null,
    overdue: false,
    draftedBy: ID,
    draftedByName: null,
    approvedBy: approvedAt === null ? null : ID,
    approvedByName: null,
    approvedAt,
    sentAt: null,
    sentVia: null,
    cancelReason: state === 'cancelled' ? 'Ordered twice' : null,
    closeReason: null,
    vendorStateCode: '08',
    placeOfSupplyStateCode: '08',
    notes: null,
    createdAt: '2026-11-01T05:00:00.000Z',
    lines: [
      {
        id: ID,
        lineNo: 1,
        itemId: ID,
        sku: 'CBL-4',
        itemName: 'Copper cable 4 sq mm',
        isSerialTracked: false,
        serialPattern: null,
        qty: '100.000',
        purchaseUnit: 'metre',
        stockUnit: 'metre',
        unitFactor: '1.000',
        qtyReceived: '0.000',
        hsn: '8544',
        taxRatePct: '18.00',
        unitRate: '1234.5678',
        amount: '123456.78',
        quoteId: null,
      },
    ],
    totals: {
      subtotal: '123456.78',
      cgst: '11111.11',
      sgst: '11111.11',
      igst: '0.00',
      taxTotal: '22222.22',
      roundOff: '0.00',
      grandTotal: '145679.00',
    },
  };
  return order;
}

function data(order: PurchaseOrderPrintData['order']): PurchaseOrderPrintData {
  return {
    order,
    company: {
      legalName: company.legalName,
      brandName: company.brandName,
      addressLines: [],
      gstin: null,
    },
    vendor: { name: 'Mewar Cables', gstin: null, addressLines: ['Udaipur'] },
  };
}

describe('the purchase order PDF', () => {
  it('prints on the letterhead, dated the day it was approved, rates as the sheet shows them', () => {
    const { html } = renderPurchaseOrder(
      data(rated('sent', '2026-11-03T06:00:00.000Z')),
      company,
      '2026-11-27',
    );
    expect(html).toContain('class="letterhead-strip"');
    expect(html).toContain('class="logo"');
    expect(html).toContain('03-11-2026');
    expect(html).not.toContain('01-11-2026');
    // ₹1,234.5678 on the sheet: the same figure, grouped, in the rate column.
    expect(html).toContain('1,234.5678');
    expect(html).not.toContain('1234.5678');
    expect(html).not.toContain('class="cancelled"');
  });

  it('marks a cancelled order across the page', () => {
    const { html } = renderPurchaseOrder(
      data(rated('cancelled', '2026-11-03T06:00:00.000Z')),
      company,
      '2026-11-27',
    );
    expect(html).toContain('class="cancelled"');
    expect(html).toContain(`>${en.print.purchaseOrder.cancelled}<`);
  });

  it('never prints a draft or an order cancelled before its approval', () => {
    expect(() => renderPurchaseOrder(data(rated('draft', null)), company, '2026-11-27')).toThrow(
      RangeError,
    );
    expect(() =>
      renderPurchaseOrder(data(rated('cancelled', null)), company, '2026-11-27'),
    ).toThrow(RangeError);
  });

  it('carries no rate, amount or total for a reader without rates', () => {
    const withRates = rated('approved', '2026-11-03T06:00:00.000Z');
    // What a reader without rates is given: the order's fields with no rate, amount or totals.
    const order = Object.fromEntries(
      Object.entries(withRates).filter(([key]) => key !== 'totals'),
    ) as unknown as PurchaseOrderDto;
    order.lines = withRates.lines.map(
      (line) =>
        Object.fromEntries(
          Object.entries(line).filter(([key]) => !['unitRate', 'amount', 'quoteId'].includes(key)),
        ) as unknown as PurchaseOrderDto['lines'][number],
    );
    expect(JSON.stringify(order)).not.toMatch(/unitRate|amount|totals/);
    const { html } = renderPurchaseOrder(data(order), company, '2026-11-27');
    expect(html).toContain(en.print.purchaseOrder.ratesWithheld);
    expect(html).not.toMatch(/1,234|1,23,456|1,45,679|₹/);
  });
});
