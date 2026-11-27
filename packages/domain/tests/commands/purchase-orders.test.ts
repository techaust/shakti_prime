// U2 purchase orders and goods receipt (docs/03-roadmap-appendix/phase3.md §7.2): the order,
// receipt and reorder commands on real Postgres. Hubs, bins, items, vendors and GST rates are this
// file's own (tagged), since the suites never clean the shared tables. Values are test data.
import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  requestPurchaseOrderPdf,
  sendPurchaseOrder,
  updatePurchaseOrder,
} from '../../src/commands/procurement/orders';
import { postGoodsReceipt, reverseGoodsReceipt } from '../../src/commands/procurement/receipts';
import {
  draftReorders,
  removeReorderRule,
  setReorderRule,
} from '../../src/commands/procurement/reorder';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import {
  getPurchaseOrder,
  getPurchaseOrderPdf,
  purchaseOrderForPrint,
  purchaseOrderMailTo,
  listGoodsReceipts,
  listPurchaseOrders,
  purchaseOrderOverdue,
} from '../../src/queries/procurement/order-queries';
import { notifyEvent } from '../../src/commands/notifications/notify';
import { purchaseOrderPdfFileId } from '../../src/procurement/po-pdf';
import { stockMove } from '../../src/stock/move';
import {
  averageOf,
  costOf,
  onHand,
  serialOf,
  stockFixture,
  type StockFixture,
} from '../stock/stock-fixture';

let f: StockFixture;
let manager: Principal; // Inventory Manager of every company: drafts
let checker: Principal; // a second Inventory Manager: approves another's drafts
let managerOne: Principal; // Inventory Manager of company 1 only
let executive: Principal;
let vendor: string;
let otherVendor: string;
let contact: string;
let meter: string; // an item bought in coils of 100 metres
let patterned: string; // a tracked item whose serials match PMP-0000

const QUOTE_DAY = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager');
  checker = await createTestPrincipal('inventory_manager');
  managerOne = await createTestPrincipal('inventory_manager', [1]);
  executive = await createTestPrincipal('executive');
  f = await stockFixture(manager.id);
  vendor = newId();
  otherVendor = newId();
  contact = newId();
  meter = newId();
  patterned = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into vendors (id, name, state_code, created_by) values
        (${vendor}, ${`PO vendor ${f.tag}`}, '08', ${manager.id}),
        (${otherVendor}, ${`PO vendor two ${f.tag}`}, '27', ${manager.id})`;
      await tx`insert into vendor_contacts (id, vendor_id, name, email, position, created_by)
        values (${contact}, ${vendor}, 'Sales desk', 'sales@example.com', 1, ${manager.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, purchase_unit, purchase_unit_factor,
                                  is_serial_tracked, serial_pattern, is_active)
        values (${meter}, ${`PM-${f.tag}`}, ${`PO cable coil ${f.tag}`}, 'cable', '8544', 'metre', 'nos', 100, false, null, true),
               (${patterned}, ${`PP-${f.tag}`}, ${`PO pump ${f.tag}`}, 'pump', '8413', 'nos', null, null, true, 'PMP-[0-9]{4}', true)`;
      // Item rates, so this file's GST never meets another suite's HSN rows.
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from) values
        (${newId()}, ${f.cable}, 18, '2020-01-01'), (${newId()}, ${f.pump}, 18, '2020-01-01'),
        (${newId()}, ${meter}, 18, '2020-01-01'), (${newId()}, ${patterned}, 12, '2020-01-01')`;
      await tx`insert into item_vendors (id, item_id, vendor_id, is_preferred, created_by) values
        (${newId()}, ${f.cable}, ${vendor}, true, ${manager.id}),
        (${newId()}, ${meter}, ${vendor}, true, ${manager.id}),
        (${newId()}, ${f.pump}, ${otherVendor}, true, ${manager.id})`;
      await tx`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, valid_from, valid_until, recorded_by)
        values (${newId()}, ${vendor}, ${f.cable}, null, 52.5, '2020-01-01', '2099-12-31', ${manager.id}),
               (${newId()}, ${vendor}, ${f.cable}, 1, 48.25, '2020-01-01', '2099-12-31', ${manager.id}),
               (${newId()}, ${vendor}, ${f.cable}, 2, 40, '2020-01-01', ${QUOTE_DAY()}, ${manager.id})`;
    }),
  );
});
afterAll(async () => {
  await asMigrator(
    (m) => m`update items set archived_at = coalesce(archived_at, now()), is_active = false
               where id in (${f.cable}, ${f.pump}, ${meter}, ${patterned})`,
  );
  await closeDb();
});

function run<T = Record<string, unknown>>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

interface Ref {
  id: string;
  entityId: number;
  poNo: string;
  state: string;
}
interface ReceiptRef {
  id: string;
  grnNo: string;
  state: string;
  purchaseOrderState: string;
  movementCount: number;
}

const draft = (extra: Record<string, unknown> = {}) => ({
  entityId: 1,
  vendorId: vendor,
  deliverToWarehouseId: f.hub,
  lines: [{ itemId: f.cable, qty: '10', rate: '100' }],
  ...extra,
});

/** A sent order of `lines`, drafted by the manager and approved by the checker. */
async function sentOrder(lines: unknown[], entityId = 1): Promise<Ref> {
  const po = await run<Ref>(manager, createPurchaseOrder, draft({ entityId, lines }));
  await run(checker, approvePurchaseOrder, { purchaseOrderId: po.id });
  return run<Ref>(manager, sendPurchaseOrder, { purchaseOrderId: po.id, via: 'by_hand' });
}

async function lineIds(poId: string): Promise<Record<string, string>> {
  const rows = await asMigrator(
    (m) =>
      m<{ id: string; item_id: string }[]>`select id, item_id from po_lines where po_id = ${poId}`,
  );
  return Object.fromEntries(rows.map((r) => [r.item_id, r.id]));
}

async function rateRows(
  poId: string,
): Promise<{ unit_rate: string; amount: string; quote_id: string | null }[]> {
  return asMigrator(
    (m) => m<{ unit_rate: string; amount: string; quote_id: string | null }[]>`
      select r.unit_rate::text, r.amount::text, r.quote_id from po_line_rates r
        join po_lines l on l.id = r.po_line_id where l.po_id = ${poId} order by l.line_no`,
  );
}

const NO_PO_WRITE = [
  'general_manager',
  'store_manager',
  'accounts',
  'tele_caller_lc',
  'project_manager',
  'agent:sizing',
  'agent:chief',
] as const;

describe('procurement.po.create / update', () => {
  it('drafts an order numbered from the series, with the amount and no rate in the audit or event', async () => {
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const po = (await asPrincipal(manager, (context) =>
      runCommand(createPurchaseOrder, { context, audit: recorded, outbox: emitted }, draft()),
    )) as Ref;
    expect(po).toMatchObject({ entityId: 1, state: 'draft' });
    expect(po.poNo).toMatch(/\/PO\/\d{4}-\d{2}\/\d{4}$/);
    expect(await rateRows(po.id)).toEqual([
      { unit_rate: '100.0000', amount: '1000.00', quote_id: null },
    ]);
    const [line] = await asMigrator(
      (m) => m<{ purchase_unit: string; unit_factor: string; tax_rate_pct: string }[]>`
        select purchase_unit, unit_factor::text, tax_rate_pct::text from po_lines where po_id = ${po.id}`,
    );
    expect(line).toEqual({ purchase_unit: 'metre', unit_factor: '1.000', tax_rate_pct: '18.00' });
    expect(recorded.records[0]).toMatchObject({
      command: 'procurement.po.create',
      after: { poNo: po.poNo, state: 'draft', lineCount: 1 },
    });
    expect(emitted.records[0]).toMatchObject({
      type: 'procurement.po.drafted',
      payload: { source: 'manual', vendorId: vendor, lineCount: 1 },
    });
    const told = JSON.stringify([recorded.records, emitted.records]);
    expect(told).not.toMatch(/1000|"rate"|amount/);
  });

  it('fills a rate from the vendor’s live quote, the company’s own before the group’s', async () => {
    const po = await run<Ref>(
      manager,
      createPurchaseOrder,
      draft({ lines: [{ itemId: f.cable, qty: '4', rateFromQuote: true }] }),
    );
    const [rate] = await rateRows(po.id);
    expect(rate).toMatchObject({ unit_rate: '48.2500', amount: '193.00' });
    expect(rate?.quote_id).not.toBeNull();
    // Company 2's quote is for company 2 only, so company 2 takes it.
    const two = await run<Ref>(
      manager,
      createPurchaseOrder,
      draft({ entityId: 2, lines: [{ itemId: f.cable, qty: '1', rateFromQuote: true }] }),
    );
    expect((await rateRows(two.id))[0]?.unit_rate).toBe('40.0000');
    await expect(
      run(
        manager,
        createPurchaseOrder,
        draft({ lines: [{ itemId: meter, qty: '1', rateFromQuote: true }] }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'po_quote_missing' } });
  });

  it('is refused without procurement.po.write, and in another company', async () => {
    for (const role of NO_PO_WRITE) {
      await expect(
        run(
          principalFor(role, [1]),
          createPurchaseOrder,
          draft({ lines: [{ itemId: f.cable, qty: '1' }] }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(
      run(managerOne, createPurchaseOrder, draft({ entityId: 2 })),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses a rate to a person without procurement.rate.read, and an unusable item, vendor or hub', async () => {
    const writerOnly = principalFor('inventory_manager', [1], {
      permissions: [{ key: 'procurement.po.write', scope: 'entity' }],
    });
    await expect(run(writerOnly, createPurchaseOrder, draft())).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'procurement_rate_required' },
    });
    await expect(
      run(manager, createPurchaseOrder, draft({ lines: [{ itemId: f.inactive, qty: '1' }] })),
    ).rejects.toMatchObject({ details: { reason: 'purchase_order_item_unusable' } });
    await expect(
      run(manager, createPurchaseOrder, draft({ deliverToWarehouseId: f.transitHub })),
    ).rejects.toMatchObject({ details: { reason: 'purchase_order_hub_unusable' } });
  });

  it('changes a draft, keeping a rate left out, and makes the editor its drafter', async () => {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    await run(checker, updatePurchaseOrder, {
      purchaseOrderId: po.id,
      expectedAt: '2026-12-15',
      lines: [
        { itemId: f.cable, qty: '20' },
        { itemId: f.pump, qty: '2', rate: '1500' },
      ],
    });
    expect(await rateRows(po.id)).toEqual([
      { unit_rate: '100.0000', amount: '2000.00', quote_id: null },
      { unit_rate: '1500.0000', amount: '3000.00', quote_id: null },
    ]);
    const [row] = await asMigrator(
      (m) => m<{ drafted_by: string; expected_at: string }[]>`
        select drafted_by, expected_at::text from purchase_orders where id = ${po.id}`,
    );
    expect(row).toEqual({ drafted_by: checker.id, expected_at: '2026-12-15' });
  });

  it('refuses a change outside a draft, and a draft of another company', async () => {
    const po = await sentOrder([{ itemId: f.cable, qty: '1', rate: '10' }]);
    await expect(
      run(manager, updatePurchaseOrder, { purchaseOrderId: po.id, notes: 'Late' }),
    ).rejects.toMatchObject({ details: { reason: 'purchase_order_transition_not_allowed' } });
    const two = await run<Ref>(manager, createPurchaseOrder, draft({ entityId: 2 }));
    await expect(
      run(managerOne, updatePurchaseOrder, { purchaseOrderId: two.id, notes: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      run(principalFor('general_manager', [1, 2]), updatePurchaseOrder, {
        purchaseOrderId: two.id,
        notes: 'x',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('procurement.po.approve (question 5 (a))', () => {
  it('lets another Inventory Manager approve below ₹2,00,000 including GST', async () => {
    const po = await run<Ref>(
      manager,
      createPurchaseOrder,
      draft({ lines: [{ itemId: f.cable, qty: '1', rate: '100000' }] }),
    );
    await expect(
      run(checker, approvePurchaseOrder, { purchaseOrderId: po.id }),
    ).resolves.toMatchObject({
      state: 'approved',
    });
  });

  it('refuses the Inventory Manager at the limit, and lets an Executive approve it', async () => {
    // ₹1,69,491.53 with 18 % GST is ₹1,99,999.99, which rounds to ₹2,00,000: at the limit.
    const po = await run<Ref>(
      manager,
      createPurchaseOrder,
      draft({ lines: [{ itemId: f.cable, qty: '1', rate: '169491.53' }] }),
    );
    await expect(
      run(checker, approvePurchaseOrder, { purchaseOrderId: po.id }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'po_approval_limit' },
    });
    await expect(
      run(executive, approvePurchaseOrder, { purchaseOrderId: po.id }),
    ).resolves.toMatchObject({
      state: 'approved',
    });
  });

  it('refuses an approver their own draft, unless they are an Executive', async () => {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    await expect(
      run(manager, approvePurchaseOrder, { purchaseOrderId: po.id }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'po_self_approval' },
    });
    const own = await run<Ref>(
      executive,
      createPurchaseOrder,
      draft({ lines: [{ itemId: f.cable, qty: '10', rate: '90000' }] }),
    );
    await expect(
      run(executive, approvePurchaseOrder, { purchaseOrderId: own.id }),
    ).resolves.toMatchObject({
      state: 'approved',
    });
  });

  it('refuses an order with a line without its rate', async () => {
    const po = await run<Ref>(
      manager,
      createPurchaseOrder,
      draft({ lines: [{ itemId: f.cable, qty: '1' }] }),
    );
    await expect(
      run(checker, approvePurchaseOrder, { purchaseOrderId: po.id }),
    ).rejects.toMatchObject({
      details: { reason: 'po_lines_incomplete' },
    });
  });

  it('is refused without procurement.po.approve, and in another company', async () => {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    for (const role of ['general_manager', 'store_manager', 'accounts', 'agent:chief'] as const) {
      await expect(
        run(principalFor(role, [1]), approvePurchaseOrder, { purchaseOrderId: po.id }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    const two = await run<Ref>(manager, createPurchaseOrder, draft({ entityId: 2 }));
    await expect(
      run(managerOne, approvePurchaseOrder, { purchaseOrderId: two.id }),
    ).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'purchase_order_missing' },
    });
  });
});

describe('procurement.po.send / cancel / close', () => {
  it('sends by email to a vendor’s person, announcing whom without a rate', async () => {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    await run(checker, approvePurchaseOrder, { purchaseOrderId: po.id });
    const emitted = memoryOutboxSink();
    const sent = (await asPrincipal(manager, (context) =>
      runCommand(
        sendPurchaseOrder,
        { context, audit, outbox: emitted },
        {
          purchaseOrderId: po.id,
          via: 'email',
          vendorContactId: contact,
        },
      ),
    )) as Ref;
    expect(sent.state).toBe('sent');
    expect(emitted.records[0]).toMatchObject({
      type: 'procurement.po.sent',
      payload: { via: 'email', vendorContactId: contact, sentBy: manager.id },
    });
  });

  it('cancels with a reason and refuses one without', async () => {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    await expect(
      run(manager, cancelPurchaseOrder, { purchaseOrderId: po.id, reason: ' ' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(manager, cancelPurchaseOrder, { purchaseOrderId: po.id, reason: 'Vendor out of stock' }),
    ).resolves.toMatchObject({ state: 'cancelled' });
    await expect(
      run(manager, closePurchaseOrder, { purchaseOrderId: po.id, reason: 'x' }),
    ).rejects.toMatchObject({ details: { reason: 'purchase_order_transition_not_allowed' } });
  });

  it('are refused without procurement.po.write, and in another company', async () => {
    const two = await run<Ref>(manager, createPurchaseOrder, draft({ entityId: 2 }));
    await run(checker, approvePurchaseOrder, { purchaseOrderId: two.id });
    for (const command of [sendPurchaseOrder, cancelPurchaseOrder, closePurchaseOrder]) {
      const input = { purchaseOrderId: two.id, via: 'by_hand', reason: 'x' };
      const body =
        command === sendPurchaseOrder
          ? { purchaseOrderId: two.id, via: 'by_hand' }
          : { purchaseOrderId: two.id, reason: input.reason };
      await expect(run(principalFor('store_manager', [2]), command, body)).rejects.toMatchObject({
        code: 'forbidden',
      });
      // Another company's order is not there to act on.
      await expect(run(managerOne, command, body)).rejects.toMatchObject({ code: 'not_found' });
    }
  });
});

describe('procurement.grn.post', () => {
  it('refuses a receipt of a tracked item with one serial missing (INV-04)', async () => {
    const po = await sentOrder([{ itemId: f.pump, qty: '3', rate: '1500' }]);
    const lines = await lineIds(po.id);
    await expect(
      run(manager, postGoodsReceipt, {
        purchaseOrderId: po.id,
        lines: [{ poLineId: lines[f.pump], qty: '3', serialNos: [`A-${f.tag}-1`, `A-${f.tag}-2`] }],
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'goods_receipt_serial_missing', missing: 1 },
    });
    const [receipts] = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from goods_receipts where po_id = ${po.id}`,
    );
    expect(receipts?.n).toBe(0);
  });

  it('refuses a repeated serial, one off the item’s pattern, and more than the order expects', async () => {
    const po = await sentOrder([
      { itemId: patterned, qty: '2', rate: '900' },
      { itemId: f.cable, qty: '5', rate: '10' },
    ]);
    const lines = await lineIds(po.id);
    const post = (line: Record<string, unknown>) =>
      run(manager, postGoodsReceipt, { purchaseOrderId: po.id, lines: [line] });
    await expect(
      post({ poLineId: lines[patterned], qty: '2', serialNos: ['PMP-0001', 'pmp-0001'] }),
    ).rejects.toMatchObject({ details: { reason: 'goods_receipt_serial_repeated' } });
    await expect(
      post({ poLineId: lines[patterned], qty: '2', serialNos: ['PMP-0001', '4006381333931'] }),
    ).rejects.toMatchObject({
      details: { reason: 'goods_receipt_serial_pattern', serialNo: '4006381333931' },
    });
    await expect(post({ poLineId: lines[f.cable], qty: '6' })).rejects.toMatchObject({
      details: { reason: 'goods_receipt_over_order' },
    });
    await expect(
      post({ poLineId: lines[f.cable], qty: '5', binId: f.otherBin }),
    ).rejects.toMatchObject({
      details: { reason: 'goods_receipt_bin_unusable' },
    });
  });

  it('is refused without procurement.grn.write, and in another company', async () => {
    const po = await sentOrder([{ itemId: f.cable, qty: '5', rate: '10' }], 2);
    const lines = await lineIds(po.id);
    const input = { purchaseOrderId: po.id, lines: [{ poLineId: lines[f.cable], qty: '1' }] };
    for (const role of ['general_manager', 'store_manager', 'accounts', 'agent:sizing'] as const) {
      await expect(run(principalFor(role, [2]), postGoodsReceipt, input)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(run(managerOne, postGoodsReceipt, input)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('moves goods in at the order’s rate and revalues the moving average (question 2 (a))', async () => {
    // 10 metres on hand at ₹100.0000, then 30 received at ₹200: (10 × 100 + 30 × 200) / 40 = 175.
    await asPrincipal(executive, (context) =>
      stockMove(context.tx, [
        {
          reason: 'adjust_gain',
          entityId: 1,
          itemId: meter,
          toBinId: f.binA,
          qty: '10',
          unitCost: '100.0000',
          note: 'Opening count of the test',
        },
      ]),
    );
    expect(await averageOf(1, meter)).toMatchObject({ avg: '100.0000' });
    // A coil of 100 metres at ₹20,000 is ₹200 a metre; 0.3 coils are 30 metres.
    const po = await sentOrder([{ itemId: meter, qty: '0.3', rate: '20000' }]);
    const lines = await lineIds(po.id);
    const emitted = memoryOutboxSink();
    const recorded = memoryAuditSink();
    const receipt = (await asPrincipal(manager, (context) =>
      runCommand(
        postGoodsReceipt,
        { context, audit: recorded, outbox: emitted },
        {
          purchaseOrderId: po.id,
          vendorInvoiceNo: 'INV-77',
          lines: [{ poLineId: lines[meter], qty: '0.3' }],
        },
      ),
    )) as ReceiptRef;
    expect(receipt).toMatchObject({
      state: 'posted',
      purchaseOrderState: 'received',
      movementCount: 1,
    });
    expect(receipt.grnNo).toMatch(/\/GRN\/\d{4}-\d{2}\/\d{4}$/);
    expect(await onHand(1, f.receiving, meter)).toBe('30.000');
    expect(await averageOf(1, meter)).toMatchObject({ avg: '175.0000' });
    const [movement] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from stock_movements where ref_id = ${receipt.id}`,
    );
    expect(await costOf(movement?.id ?? '')).toBe('200.0000');
    const [kept] = await asMigrator(
      (m) => m<{ unit_rate: string }[]>`
        select x.unit_rate::text from goods_receipt_line_rates x
          join goods_receipt_lines l on l.id = x.receipt_line_id where l.receipt_id = ${receipt.id}`,
    );
    expect(kept?.unit_rate).toBe('20000.0000');
    expect(emitted.records.map((e) => e.type)).toEqual([
      'inventory.stock.moved',
      'procurement.receipt.posted',
    ]);
    expect(JSON.stringify([emitted.records, recorded.records])).not.toMatch(/20000|cost|rate/i);
  });

  it('brings every serial in, recorded against its vendor and receipt line', async () => {
    const po = await sentOrder([{ itemId: f.pump, qty: '3', rate: '1500' }]);
    const lines = await lineIds(po.id);
    const serials = [1, 2, 3].map((n) => `R-${f.tag}-${String(n)}`);
    const first = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.pump], qty: '2', serialNos: serials.slice(0, 2) }],
    });
    expect(first).toMatchObject({ purchaseOrderState: 'partially_received', movementCount: 2 });
    const serial = await serialOf(f.pump, serials[0] ?? '');
    expect(serial).toMatchObject({ state: 'in_stock', binId: f.receiving });
    const [facts] = await asMigrator(
      (m) => m<{ vendor_id: string; receipt_line_id: string | null }[]>`
        select vendor_id, receipt_line_id from serials where id = ${serial?.id ?? ''}`,
    );
    expect(facts?.vendor_id).toBe(vendor);
    expect(facts?.receipt_line_id).not.toBeNull();
    // A number the item already has is refused.
    await expect(
      run(manager, postGoodsReceipt, {
        purchaseOrderId: po.id,
        lines: [{ poLineId: lines[f.pump], qty: '1', serialNos: [serials[0]] }],
      }),
    ).rejects.toMatchObject({ details: { reason: 'goods_receipt_serial_taken' } });
    const rest = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.pump], qty: '1', serialNos: [serials[2]] }],
    });
    expect(rest.purchaseOrderState).toBe('received');
  });
});

describe('procurement.grn.reverse', () => {
  it('takes a whole receipt back out while nothing has moved on, restoring the average', async () => {
    // 2 metres at ₹50, then 8 received at ₹64: (100 + 512) / 10 = 61.2; reversed, back to 50.
    await asPrincipal(executive, (context) =>
      stockMove(context.tx, [
        {
          reason: 'adjust_gain',
          entityId: 4,
          itemId: f.cable,
          toBinId: f.binA,
          qty: '2',
          unitCost: '50.0000',
        },
      ]),
    );
    const po = await sentOrder([{ itemId: f.cable, qty: '8', rate: '64' }], 4);
    const lines = await lineIds(po.id);
    const receipt = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.cable], qty: '8', binId: f.binB }],
    });
    expect((await averageOf(4, f.cable)).avg).toBe('61.2000');
    const reversed = await run<ReceiptRef>(manager, reverseGoodsReceipt, {
      receiptId: receipt.id,
      reason: 'Posted against the wrong order',
    });
    expect(reversed).toMatchObject({ state: 'reversed', purchaseOrderState: 'sent' });
    expect(await onHand(4, f.binB, f.cable)).toBe('0.000');
    expect((await averageOf(4, f.cable)).avg).toBe('50.0000');
    await expect(
      run(manager, reverseGoodsReceipt, { receiptId: receipt.id, reason: 'Again' }),
    ).rejects.toMatchObject({ details: { reason: 'goods_receipt_reversed' } });
  });

  it('takes a tracked receipt back out and receives the same serials again', async () => {
    const po = await sentOrder([{ itemId: f.pump, qty: '2', rate: '1500' }]);
    const lines = await lineIds(po.id);
    const numbers = [`V-${f.tag}-1`, `V-${f.tag}-2`];
    const receipt = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.pump], qty: '2', serialNos: numbers }],
    });
    await run(manager, reverseGoodsReceipt, { receiptId: receipt.id, reason: 'Wrong order' });
    expect(await serialOf(f.pump, numbers[0] ?? '')).toMatchObject({
      state: 'scrapped',
      binId: null,
    });
    const again = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.pump], qty: '2', serialNos: numbers }],
    });
    expect(again).toMatchObject({ purchaseOrderState: 'received', movementCount: 2 });
    expect(await serialOf(f.pump, numbers[1] ?? '')).toMatchObject({ state: 'in_stock' });
  });

  it('refuses a reversal once the receipt’s stock has moved on', async () => {
    const po = await sentOrder([{ itemId: f.cable, qty: '4', rate: '50' }]);
    const lines = await lineIds(po.id);
    const receipt = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.cable], qty: '4' }],
    });
    await asPrincipal(manager, (context) =>
      stockMove(context.tx, [
        {
          reason: 'transfer',
          entityId: 1,
          itemId: f.cable,
          fromBinId: f.receiving,
          toBinId: f.binA,
          qty: '1',
        },
      ]),
    );
    await expect(
      run(manager, reverseGoodsReceipt, { receiptId: receipt.id, reason: 'Wrong order' }),
    ).rejects.toMatchObject({ details: { reason: 'goods_receipt_moved_on' } });
  });

  it('is refused without procurement.grn.write, and in another company', async () => {
    // A real receipt of company 2 (review finding 7).
    const po = await sentOrder([{ itemId: f.cable, qty: '2', rate: '30' }], 2);
    const lines = await lineIds(po.id);
    const { id: receiptId } = await run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.cable], qty: '2' }],
    });
    for (const role of ['general_manager', 'store_manager', 'agent:chief'] as const) {
      await expect(
        run(principalFor(role, [2]), reverseGoodsReceipt, { receiptId, reason: 'x' }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    // Company 1's Inventory Manager does not find company 2's receipt to reverse.
    await expect(
      run(managerOne, reverseGoodsReceipt, { receiptId, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'goods_receipt_missing' } });
    const [kept] = await asMigrator(
      (m) => m<{ state: string }[]>`select state from goods_receipts where id = ${receiptId}`,
    );
    expect(kept?.state).toBe('posted');
  });

  /** A sent order of 4 metres of cable for company 3, received into bin B. */
  async function receivedIntoB(): Promise<ReceiptRef> {
    const po = await sentOrder([{ itemId: f.cable, qty: '4', rate: '50' }], 3);
    const lines = await lineIds(po.id);
    return run<ReceiptRef>(manager, postGoodsReceipt, {
      purchaseOrderId: po.id,
      lines: [{ poLineId: lines[f.cable], qty: '4', binId: f.binB }],
    });
  }
  /** One metre of company 3's cable lost out of bin B. */
  const lossFromB = () => ({
    reason: 'adjust_loss' as const,
    entityId: 3,
    itemId: f.cable,
    fromBinId: f.binB,
    qty: '1',
    note: 'Cut length found short',
  });

  it('refuses a reversal after an issue whose transaction began before the receipt (review finding 6)', async () => {
    // Stock enough in the bin that the receipt's quantity stays there after the issue: only the
    // issue's being after the receipt refuses the reversal.
    await asPrincipal(executive, (context) =>
      stockMove(context.tx, [
        {
          reason: 'adjust_gain',
          entityId: 3,
          itemId: f.cable,
          toBinId: f.binB,
          qty: '5',
          unitCost: '50.0000',
        },
      ]),
    );
    let begun!: () => void;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let go!: () => void;
    const received = new Promise<void>((resolve) => {
      go = resolve;
    });
    // The issue's transaction starts (and so its moved_at is fixed) before the receipt exists.
    const issue = asPrincipal(executive, async (context) => {
      await context.tx.execute(sql`select 1`);
      begun();
      await received;
      await stockMove(context.tx, [lossFromB()]);
    });
    await started;
    const receipt = await receivedIntoB();
    go();
    await issue;
    const moves = await asMigrator(
      (m) => m<{ reason: string; earlier: boolean }[]>`
        select m.reason, m.moved_at < (select r.moved_at from stock_movements r
                                        where r.ref_id = ${receipt.id} and r.reason = 'receipt') as earlier
          from stock_movements m
         where m.entity_id = 3 and m.item_id = ${f.cable} and m.from_bin_id = ${f.binB}
         order by m.id desc limit 1`,
    );
    // Older by moved_at, written after: the reversal must see it.
    expect(moves).toEqual([{ reason: 'adjust_loss', earlier: true }]);
    await expect(
      run(manager, reverseGoodsReceipt, { receiptId: receipt.id, reason: 'Wrong order' }),
    ).rejects.toMatchObject({ details: { reason: 'goods_receipt_moved_on' } });
  });

  it('holds a reversal behind an issue in progress from its bin, then refuses it', async () => {
    const receipt = await receivedIntoB();
    let holding!: (pid: number) => void;
    const held = new Promise<number>((resolve) => {
      holding = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The issue holds the bin's balance and has not committed yet.
    const issue = asPrincipal(executive, async (context) => {
      await stockMove(context.tx, [lossFromB()]);
      const [me] = (await context.tx.execute(
        sql`select pg_backend_pid() as pid`,
      )) as unknown as { pid: number }[];
      holding(me?.pid ?? 0);
      await gate;
    });
    const issuer = await held;
    let settled = false;
    const reversal = run(manager, reverseGoodsReceipt, {
      receiptId: receipt.id,
      reason: 'Wrong order',
    })
      .then(
        () => 'reversed',
        (e: unknown) => e,
      )
      .finally(() => {
        settled = true;
      });
    try {
      // The reversal waits on a lock the issue holds (read from pg_stat_activity, review R5), so
      // a reversal that never waits fails here on any machine.
      await waitForLockWait(issuer);
      expect(settled).toBe(false);
    } finally {
      release();
      await issue;
    }
    expect(await reversal).toMatchObject({ details: { reason: 'goods_receipt_moved_on' } });
    const [kept] = await asMigrator(
      (m) => m<{ state: string }[]>`select state from goods_receipts where id = ${receipt.id}`,
    );
    expect(kept?.state).toBe('posted');
  });
});

/** Polls until a backend other than `holder` waits on a lock it holds; fails after 10 s. */
async function waitForLockWait(holder: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  await asMigrator(async (m) => {
    for (;;) {
      const [row] = await m<{ waiting: number }[]>`
        select count(*)::int as waiting
          from pg_stat_activity
         where pid <> ${holder}
           and wait_event_type = 'Lock'
           and ${holder} = any (pg_blocking_pids(pid))`;
      if ((row?.waiting ?? 0) > 0) return;
      if (Date.now() > deadline) {
        throw new Error('the reversal did not wait on the issue within 10 seconds');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
}

describe('reorder rules and procurement.reorder.draft', () => {
  it('sets and removes a rule, refused without procurement.po.write and in another company', async () => {
    const rule = {
      entityId: 1,
      itemId: f.pump,
      warehouseId: f.hub,
      reorderLevel: '1',
      reorderQty: '2',
    };
    await expect(
      run(principalFor('store_manager', [1]), setReorderRule, rule),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(managerOne, setReorderRule, { ...rule, entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(manager, setReorderRule, { ...rule, reorderQty: '1.5' }),
    ).rejects.toMatchObject({
      details: { reason: 'reorder_rule_whole_units' },
    });
    const made = await run<{ id: string; reorderLevel: string }>(manager, setReorderRule, rule);
    const again = await run<{ id: string; reorderLevel: string }>(manager, setReorderRule, {
      ...rule,
      reorderLevel: '3',
    });
    expect(again).toMatchObject({ id: made.id, reorderLevel: '3.000' });
    await expect(
      run(principalFor('general_manager', [1]), removeReorderRule, { ruleId: made.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Another company's manager finds nothing to remove.
    await expect(
      run(principalFor('inventory_manager', [2]), removeReorderRule, { ruleId: made.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await run(manager, removeReorderRule, { ruleId: made.id });
  });

  it('drafts one order per preferred vendor and hub, with quantities and no rate, once', async () => {
    const workers = principalFor('system:workers', [1, 2, 3, 4], {
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
    });
    // Company 3: nothing of these items is on hand or on order there.
    await run(manager, setReorderRule, {
      entityId: 3,
      itemId: f.cable,
      warehouseId: f.hub,
      reorderLevel: '50',
      reorderQty: '120',
    });
    await run(manager, setReorderRule, {
      entityId: 3,
      itemId: meter,
      warehouseId: f.hub,
      reorderLevel: '100',
      reorderQty: '250',
    });
    await run(manager, setReorderRule, {
      entityId: 3,
      itemId: f.pump,
      warehouseId: f.hub,
      reorderLevel: '2',
      reorderQty: '4',
    });
    await run(manager, setReorderRule, {
      entityId: 3,
      itemId: patterned,
      warehouseId: f.hub,
      reorderLevel: '2',
      reorderQty: '4',
    });
    const emitted = memoryOutboxSink();
    const out = (await asPrincipal(workers, (context) =>
      runCommand(draftReorders, { context, audit, outbox: emitted }, { entityId: 3 }),
    )) as { purchaseOrderIds: string[]; itemsWithoutVendor: number };
    expect(out.purchaseOrderIds).toHaveLength(2);
    expect(out.itemsWithoutVendor).toBe(1);
    const orders = await asMigrator(
      (m) => m<
        { id: string; vendor_id: string; state: string; source: string; drafted_by: string }[]
      >`
        select id, vendor_id, state, source, drafted_by from purchase_orders
         where id in ${m(out.purchaseOrderIds)} order by vendor_id`,
    );
    expect(orders.map((o) => [o.state, o.source, o.drafted_by])).toEqual([
      ['draft', 'reorder', workers.id],
      ['draft', 'reorder', workers.id],
    ]);
    const quantities = await asMigrator(
      (m) => m<{ item_id: string; qty: string; tax_rate_pct: string | null }[]>`
        select item_id, qty::text, tax_rate_pct::text from po_lines
         where po_id in ${m(out.purchaseOrderIds)} order by qty`,
    );
    // 250 metres in coils of 100 are 3 coils; 120 metres of cable; 4 pumps.
    expect(Object.fromEntries(quantities.map((q) => [q.item_id, q.qty]))).toEqual({
      [meter]: '3.000',
      [f.cable]: '120.000',
      [f.pump]: '4.000',
    });
    const [rates] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from po_line_rates r join po_lines l on l.id = r.po_line_id
         where l.po_id in ${m(out.purchaseOrderIds)}`,
    );
    expect(rates?.n).toBe(0);
    expect(emitted.records.map((e) => e.payload)).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'reorder' })]),
    );
    // The company's order writers are told of a reorder draft, once; a person's order tells nobody.
    const writer = await createTestUser([{ entityId: 3, roleKey: 'inventory_manager' }]);
    const caller = await createTestUser([{ entityId: 3, roleKey: 'tele_caller_cc' }]);
    const notify = (purchaseOrderId: string, fromReorder: boolean) =>
      asPrincipal(workers, (context) =>
        runCommand(
          notifyEvent,
          { context, audit, outbox },
          {
            event: 'procurement.po.drafted',
            entityId: 3,
            eventId: newId(),
            purchaseOrderId,
            fromReorder,
          },
        ),
      );
    const firstOrder = out.purchaseOrderIds[0] ?? '';
    await notify(firstOrder, true);
    await notify(firstOrder, true);
    await notify(firstOrder, false);
    const told = await asMigrator(
      (m) => m<{ user_id: string; type: string; subject_type: string }[]>`
        select user_id, type, subject_type from notifications
         where subject_id = ${firstOrder} and user_id in (${writer.id}, ${caller.id})`,
    );
    expect(told).toEqual([
      { user_id: writer.id, type: 'reorder_drafted', subject_type: 'purchase_order' },
    ]);
    // What is now on order covers the rules: a second run drafts nothing.
    const again = (await asPrincipal(workers, (context) =>
      runCommand(draftReorders, { context, audit, outbox }, { entityId: 3 }),
    )) as { purchaseOrderIds: string[] };
    expect(again.purchaseOrderIds).toEqual([]);
  });

  it('is the platform’s only: refused to every person, an Executive included, and in another company', async () => {
    for (const who of [executive, manager, principalFor('agent:chief', [1])]) {
      await expect(run(who, draftReorders, { entityId: 1 })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(
      run(principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID }), draftReorders, {
        entityId: 2,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the purchase order’s PDF and its mail (review R2)', () => {
  // A real person sends: their address is the email's reply-to, and they are the one told.
  let buyer: { id: string; email: string };
  let buyerAsPrincipal: Principal;
  beforeAll(async () => {
    buyer = await createTestUser([{ entityId: 1, roleKey: 'inventory_manager' }]);
    buyerAsPrincipal = principalFor('inventory_manager', [1], { id: buyer.id });
  });
  const renderWorker = (entityIds: number[]) =>
    principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  const readPrint = (who: Principal, purchaseOrderId: string, version: 1 | 2) =>
    asPrincipal(who, (context) => purchaseOrderForPrint(context, { purchaseOrderId, version }));
  const readMailTo = (who: Principal, purchaseOrderId: string) =>
    asPrincipal(who, (context) =>
      purchaseOrderMailTo(context, {
        purchaseOrderId,
        vendorContactId: contact,
        sentBy: buyer.id,
      }),
    );
  const askPdf = (who: Principal, purchaseOrderId: string) => {
    const emitted = memoryOutboxSink();
    return asPrincipal(who, (context) =>
      runCommand(requestPurchaseOrderPdf, { context, audit, outbox: emitted }, { purchaseOrderId }),
    ).then((answer) => ({ answer, emitted: emitted.records }));
  };

  /** An approved order of 10 metres at ₹100. */
  async function approved(): Promise<Ref> {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    return run<Ref>(checker, approvePurchaseOrder, { purchaseOrderId: po.id });
  }

  /** An approved order of 10 metres at ₹100, sent `via`. */
  async function sentVia(via: 'email' | 'by_hand'): Promise<Ref> {
    const po = await approved();
    return run<Ref>(buyerAsPrincipal, sendPurchaseOrder, {
      purchaseOrderId: po.id,
      via,
      ...(via === 'email' ? { vendorContactId: contact } : {}),
    });
  }

  it('asks the render worker for the PDF on approval, and for the cancelled one on cancelling', async () => {
    const po = await run<Ref>(manager, createPurchaseOrder, draft());
    const emitted = memoryOutboxSink();
    await asPrincipal(checker, (context) =>
      runCommand(approvePurchaseOrder, { context, audit, outbox: emitted }, { purchaseOrderId: po.id }),
    );
    const cancelled = memoryOutboxSink();
    await asPrincipal(manager, (context) =>
      runCommand(
        cancelPurchaseOrder,
        { context, audit, outbox: cancelled },
        { purchaseOrderId: po.id, reason: 'Vendor out of stock' },
      ),
    );
    const print = (version: number) => ({
      type: 'print.document.requested',
      entityId: 1,
      aggregateType: 'purchase_order',
      aggregateId: po.id,
      payload: { documentType: 'purchase_order', documentId: po.id, version, v: 1 },
    });
    expect(emitted.records).toEqual([
      expect.objectContaining({ type: 'procurement.po.approved' }),
      expect.objectContaining(print(1)),
    ]);
    expect(cancelled.records).toEqual([
      expect.objectContaining({ type: 'procurement.po.cancelled' }),
      expect.objectContaining(print(2)),
    ]);
    // A draft cancelled before approval never printed, so nothing is asked for.
    const neverApproved = await run<Ref>(manager, createPurchaseOrder, draft());
    const none = memoryOutboxSink();
    await asPrincipal(manager, (context) =>
      runCommand(
        cancelPurchaseOrder,
        { context, audit, outbox: none },
        { purchaseOrderId: neverApproved.id, reason: 'Not needed' },
      ),
    );
    expect(none.records.map((e) => e.type)).toEqual(['procurement.po.cancelled']);
  });

  it('gives the render worker an approved order with its rates, by version', async () => {
    const po = await approved();
    const print = await readPrint(renderWorker([1]), po.id, 1);
    expect(print?.order).toMatchObject({ id: po.id, state: 'approved' });
    expect(print?.order.lines).toEqual([
      expect.objectContaining({ itemId: f.cable, unitRate: '100.0000', amount: '1000.00' }),
    ]);
    expect(print?.order.totals?.subtotal).toBe('1000.00');
    expect(print?.vendor.name).toBe(`PO vendor ${f.tag}`);
    expect(print?.company.legalName).toBeTruthy();
    // Not cancelled: no cancelled version. Another company's worker, a draft: nothing.
    expect(await readPrint(renderWorker([1]), po.id, 2)).toBeUndefined();
    expect(await readPrint(renderWorker([2]), po.id, 1)).toBeUndefined();
    const draftOrder = await run<Ref>(manager, createPurchaseOrder, draft());
    expect(await readPrint(renderWorker([1]), draftOrder.id, 1)).toBeUndefined();
    // Cancelled after approval: both versions print, the order as approved and marked cancelled.
    await run(manager, cancelPurchaseOrder, { purchaseOrderId: po.id, reason: 'Twice' });
    expect((await readPrint(renderWorker([1]), po.id, 1))?.order.state).toBe('cancelled');
    expect((await readPrint(renderWorker([1]), po.id, 2))?.order.state).toBe('cancelled');
  });

  it('gives the worker whom to mail an order sent by email, and no rate', async () => {
    const po = await sentVia('email');
    const mail = await readMailTo(renderWorker([1]), po.id);
    expect(mail).toEqual({
      poNo: po.poNo,
      companyName: expect.any(String) as unknown,
      to: { name: 'Sales desk', email: 'sales@example.com' },
      replyTo: buyer.email,
    });
    // Another company's worker, an order sent by hand, an order cancelled since: nothing to mail.
    expect(await readMailTo(renderWorker([2]), po.id)).toBeUndefined();
    expect(await readMailTo(renderWorker([1]), (await sentVia('by_hand')).id)).toBeUndefined();
    const cancelled = await sentVia('email');
    await run(manager, cancelPurchaseOrder, { purchaseOrderId: cancelled.id, reason: 'Twice' });
    expect(await readMailTo(renderWorker([1]), cancelled.id)).toBeUndefined();
  });

  it('is the platform’s only: no person reads through either definer, an Executive included', async () => {
    const po = await sentVia('email');
    for (const who of [executive, manager, principalFor('agent:chief', [1])]) {
      await expect(readPrint(who, po.id, 1)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(readMailTo(who, po.id)).rejects.toMatchObject({ code: 'forbidden' });
      for (const call of [
        sql`select app.purchase_order_for_print(${po.id}::uuid, 1)`,
        sql`select app.purchase_order_mail_to(${po.id}::uuid, ${contact}::uuid, ${buyer.id}::uuid)`,
      ]) {
        await expect(asPrincipal(who, ({ tx }) => tx.execute(call))).rejects.toMatchObject({
          cause: { code: '42501' },
        });
      }
    }
  });

  it('procurement.po.pdf.request: the current version’s file, asked for until it is stored', async () => {
    const po = await approved();
    const fileId = purchaseOrderPdfFileId(po.id, 1);
    const first = await askPdf(manager, po.id);
    expect(first.answer).toEqual({ purchaseOrderId: po.id, entityId: 1, fileId, ready: false });
    expect(first.emitted).toEqual([
      expect.objectContaining({
        type: 'print.document.requested',
        aggregateId: po.id,
        payload: { documentType: 'purchase_order', documentId: po.id, version: 1, v: 1 },
      }),
    ]);
    // Once the worker stored it, the file is answered and nothing more is asked.
    await asMigrator(
      (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                  sha256, status, created_by)
               values (${fileId}, 1, 'purchase_order_pdf', 'local', ${`1/purchase_order_pdf/${fileId}.pdf`},
                       ${`${po.poNo.replaceAll('/', '-')}.pdf`}, 'application/pdf', 10,
                       ${'0'.repeat(64)}, 'ready', ${SYSTEM_WORKERS_PRINCIPAL_ID})`,
    );
    const again = await askPdf(manager, po.id);
    expect(again.answer).toMatchObject({ fileId, ready: true });
    expect(again.emitted).toEqual([]);
    // Cancelled: the cancelled version, which is not stored yet.
    await run(manager, cancelPurchaseOrder, { purchaseOrderId: po.id, reason: 'Twice' });
    expect((await askPdf(manager, po.id)).answer).toMatchObject({
      fileId: purchaseOrderPdfFileId(po.id, 2),
      ready: false,
    });
  });

  it('procurement.po.pdf.request: refused without rates, in another company and for a draft', async () => {
    const po = await approved();
    for (const role of ['general_manager', 'store_manager'] as const) {
      await expect(askPdf(principalFor(role, [1]), po.id)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(askPdf(principalFor('inventory_manager', [2]), po.id)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'purchase_order_missing' },
    });
    const draftOrder = await run<Ref>(manager, createPurchaseOrder, draft());
    await expect(askPdf(manager, draftOrder.id)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'purchase_order_missing' },
    });
    // The person's read of the stored file follows procurement.rate.read too.
    for (const role of ['general_manager', 'store_manager'] as const) {
      await expect(
        asPrincipal(principalFor(role, [1]), (context) =>
          getPurchaseOrderPdf(context, { purchaseOrderId: po.id }),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('tells the sender once when the email did not go', async () => {
    const po = await sentVia('email');
    for (let i = 0; i < 2; i += 1) {
      await asPrincipal(renderWorker([1]), (context) =>
        runCommand(
          notifyEvent,
          { context, audit, outbox },
          {
            event: 'procurement.po.sent',
            entityId: 1,
            eventId: newId(),
            purchaseOrderId: po.id,
            sentBy: buyer.id,
          },
        ),
      );
    }
    const told = await asMigrator(
      (m) => m<{ user_id: string; type: string; subject_type: string }[]>`
        select user_id, type, subject_type from notifications where subject_id = ${po.id}`,
    );
    expect(told).toEqual([
      { user_id: buyer.id, type: 'po_mail_not_sent', subject_type: 'purchase_order' },
    ]);
  });
});

describe('the order and receipt reads', () => {
  it('give the General Manager and the Store Manager the order without a rate, and a rate reader its totals', async () => {
    const po = await run<Ref>(
      manager,
      createPurchaseOrder,
      draft({ lines: [{ itemId: f.cable, qty: '10', rate: '100' }] }),
    );
    for (const role of ['general_manager', 'store_manager'] as const) {
      const order = await asPrincipal(principalFor(role, [1]), (context) =>
        getPurchaseOrder(context, { purchaseOrderId: po.id }),
      );
      expect(order.poNo).toBe(po.poNo);
      expect(JSON.stringify(order)).not.toMatch(/unitRate|amount|totals|1000|100\.0000/);
    }
    const rated = await asPrincipal(manager, (context) =>
      getPurchaseOrder(context, { purchaseOrderId: po.id }),
    );
    // 10 × ₹100 within Rajasthan at 18 %: ₹1,000 + ₹90 + ₹90.
    expect(rated).toMatchObject({
      lines: [{ unitRate: '100.0000', amount: '1000.00' }],
      totals: { subtotal: '1000.00', cgst: '90.00', sgst: '90.00', grandTotal: '1180.00' },
    });
    await expect(
      asPrincipal(principalFor('inventory_manager', [2]), (context) =>
        getPurchaseOrder(context, { purchaseOrderId: po.id }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (context) =>
        getPurchaseOrder(context, { purchaseOrderId: po.id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('list a company’s orders by state with its reorder drafts on top, and its receipts', async () => {
    const page = await asPrincipal(principalFor('general_manager', [3]), (context) =>
      listPurchaseOrders(context, { entityId: 3, state: 'draft' }),
    );
    expect(page.reorderAlerts.length).toBeGreaterThan(0);
    expect(page.reorderAlerts.every((o) => o.source === 'reorder')).toBe(true);
    expect(page.counts.draft).toBeGreaterThanOrEqual(page.items.length);
    expect(JSON.stringify(page)).not.toMatch(/rate|amount/i);
    const receipts = await asPrincipal(principalFor('store_manager', [1]), (context) =>
      listGoodsReceipts(context, { entityId: 1 }),
    );
    expect(JSON.stringify(receipts)).not.toMatch(/rate|amount/i);
    await expect(
      asPrincipal(principalFor('store_manager', [1]), (context) =>
        listPurchaseOrders(context, { entityId: 2, state: 'draft' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('call an open order overdue a week after its expected date, in India', () => {
    const now = new Date('2026-11-27T20:00:00.000Z'); // 28-11-2026 01:30 in India
    expect(purchaseOrderOverdue('sent', '2026-11-20', now)).toBe(true);
    expect(purchaseOrderOverdue('sent', '2026-11-21', now)).toBe(false);
    expect(purchaseOrderOverdue('received', '2026-01-01', now)).toBe(false);
    expect(purchaseOrderOverdue('draft', '2026-01-01', now)).toBe(false);
    expect(purchaseOrderOverdue('sent', null, now)).toBe(false);
  });
});
