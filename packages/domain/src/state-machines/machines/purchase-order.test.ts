import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { transition } from '../define-machine';
import { everything, holding, platform } from '../test-support';
import {
  PO_APPROVAL_LIMIT_PAISE,
  purchaseOrderMachine,
  type PurchaseOrderRecord,
} from './purchase-order';

const NOW = new Date('2026-11-27T06:30:00.000Z');

const inventoryManager = holding(
  [
    { key: 'procurement.po.approve', scope: 'entity' },
    { key: 'procurement.rate.read', scope: 'entity' },
    { key: 'procurement.po.write', scope: 'entity' },
  ],
  'inventory_manager',
);

function record(extra: Partial<PurchaseOrderRecord> = {}): PurchaseOrderRecord {
  return {
    state: 'draft',
    lineCount: 1,
    linesComplete: true,
    grandTotalPaise: PO_APPROVAL_LIMIT_PAISE - 1n,
    draftedBy: newId(),
    ...extra,
  };
}

describe('the purchase order machine (question 5 (a))', () => {
  it('takes ₹2,00,000 including GST as the limit', () => {
    expect(PO_APPROVAL_LIMIT_PAISE).toBe(20_000_000n);
  });

  it('lets the Inventory Manager approve another person’s order below the limit', () => {
    expect(
      transition(purchaseOrderMachine, record(), 'approve', {
        actor: inventoryManager,
        now: NOW,
        params: {},
      }).to,
    ).toBe('approved');
  });

  it('lets an Executive approve their own order at any amount', () => {
    const executive = everything('executive');
    if (executive.kind !== 'principal') throw new Error('a person');
    const own = record({
      draftedBy: executive.principal.id,
      grandTotalPaise: PO_APPROVAL_LIMIT_PAISE * 10n,
    });
    expect(
      transition(purchaseOrderMachine, own, 'approve', { actor: executive, now: NOW, params: {} })
        .to,
    ).toBe('approved');
  });

  it('refuses an approval without procurement.po.approve, and the platform', () => {
    const writer = holding([{ key: 'procurement.po.write', scope: 'entity' }], 'inventory_manager');
    expect(() =>
      transition(purchaseOrderMachine, record(), 'approve', { actor: writer, now: NOW, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() =>
      transition(purchaseOrderMachine, record(), 'approve', {
        actor: platform,
        now: NOW,
        params: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('lets the platform draft (the reorder job) but nothing else', () => {
    expect(
      transition(purchaseOrderMachine, record({ state: null }), 'create', {
        actor: platform,
        now: NOW,
        params: {},
      }).to,
    ).toBe('draft');
    expect(() =>
      transition(purchaseOrderMachine, record(), 'update', { actor: platform, now: NOW, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('changes lines only in draft, and reverses a receipt only while the order is open', () => {
    const actor = everything();
    expect(() =>
      transition(purchaseOrderMachine, record({ state: 'approved' }), 'update', {
        actor,
        now: NOW,
        params: {},
      }),
    ).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'purchase_order_transition_not_allowed' }) }));
    expect(() =>
      transition(purchaseOrderMachine, record({ state: 'closed' }), 'unreceive', {
        actor,
        now: NOW,
        params: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'conflict' }));
  });
});
