import { IdSchema, newId, purchaseOrderPdfVersion } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { purchaseOrderPdfFileId } from './po-pdf';

describe('a purchase order’s PDF', () => {
  it('prints from approval on, the cancelled version once cancelled after approval', () => {
    const at = '2026-11-27T10:00:00.000Z';
    expect(purchaseOrderPdfVersion('draft', null)).toBeUndefined();
    expect(purchaseOrderPdfVersion('cancelled', null)).toBeUndefined();
    for (const state of ['approved', 'sent', 'partially_received', 'received', 'closed'] as const) {
      expect(purchaseOrderPdfVersion(state, at)).toBe(1);
    }
    expect(purchaseOrderPdfVersion('cancelled', at)).toBe(2);
  });

  it('keeps one file id per order and version, a UUID v7 with the order’s time prefix', () => {
    const order = newId();
    const first = purchaseOrderPdfFileId(order, 1);
    expect(IdSchema.safeParse(first).success).toBe(true);
    expect(first.slice(0, 13)).toBe(order.slice(0, 13));
    expect(purchaseOrderPdfFileId(order, 1)).toBe(first);
    expect(purchaseOrderPdfFileId(order.toUpperCase(), 1)).toBe(first);
    expect(purchaseOrderPdfFileId(order, 2)).not.toBe(first);
    expect(purchaseOrderPdfFileId(newId(), 1)).not.toBe(first);
    expect(IdSchema.safeParse(purchaseOrderPdfFileId(order, 2)).success).toBe(true);
  });
});
