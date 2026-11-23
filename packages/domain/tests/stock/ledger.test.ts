import { newId, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stockMove, type StockMoveLine } from '../../src/stock/move';
import { averageOf, costOf, onHand, serialOf, stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/**
 * `app.stock_move()`, the ledger's one write path (docs/03-roadmap-appendix/phase3.md §5, §6.2):
 * each reason's grant, every refusal, the moving average (question 2 (a), STOCK-2), the serial in
 * step with its movements, reversals and opening stock once per company.
 */

let f: StockFixture;
let manager: Principal;
let exec: Principal;
let serialSeq = 0;
const serialNo = () => `SN-${f.tag}-${String((serialSeq += 1))}`;

function move(principal: Principal, lines: readonly StockMoveLine[]): Promise<string[]> {
  return asPrincipal(principal, ({ tx }) => stockMove(tx, lines));
}

/** A gain of `qty` metres of cable into `bin` for company 1, at `unitCost` when given. */
const gain = (bin: string, qty: string, unitCost?: string): StockMoveLine => ({
  reason: 'adjust_gain',
  entityId: 1,
  itemId: f.cable,
  toBinId: bin,
  qty,
  unitCost: unitCost ?? null,
});

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager', [1]);
  exec = await createTestPrincipal('executive');
  f = await stockFixture(exec.id);
});

describe('grants, per reason, from the request', () => {
  it('lets the Inventory Manager adjust and move in their company', async () => {
    const ids = await move(manager, [gain(f.binA, '10'), { ...gain(f.binA, '1'), reason: 'count' }]);
    expect(ids).toHaveLength(2);
    await move(manager, [
      { reason: 'transfer', entityId: 1, itemId: f.cable, fromBinId: f.binA, toBinId: f.binB, qty: '4' },
    ]);
    expect(await onHand(1, f.binA, f.cable)).toBe('7.000');
    expect(await onHand(1, f.binB, f.cable)).toBe('4.000');
  });

  it('refuses a role without the reason’s grant, and a company outside the request', async () => {
    for (const roleKey of ['general_manager', 'store_manager', 'accounts', 'agent:sizing'] as const) {
      const who = await createTestPrincipal(roleKey, [1]);
      await expect(move(who, [gain(f.binA, '1')]), roleKey).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    }
    // A Field Engineer's own scope moves no stock until Phase 4 says what own means for stock.
    const field = await createTestPrincipal('field_engineer', [1]);
    await expect(
      move(field, [
        { reason: 'transfer', entityId: 1, itemId: f.cable, fromBinId: f.binA, toBinId: f.binB, qty: '1' },
      ]),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(move(manager, [{ ...gain(f.binA, '1'), entityId: 2 }])).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('refuses every reason a later slice opens', async () => {
    for (const reason of [
      'receipt',
      'pick',
      'issue',
      'return_customer',
      'return_supplier',
      'warranty_replacement',
      'surplus_in',
      'surplus_out',
    ] as const) {
      await expect(move(exec, [{ ...gain(f.binA, '1'), reason }]), reason).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason: 'stock_reason_not_open' },
      });
    }
  });
});

describe('refusals', () => {
  it('refuses a movement that would take a bin below zero, naming the item and bin', async () => {
    const before = await onHand(1, f.binB, f.cable);
    await expect(
      move(manager, [{ reason: 'adjust_loss', entityId: 1, itemId: f.cable, fromBinId: f.binB, qty: '999' }]),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'stock_insufficient', itemId: f.cable, sku: `SC-${f.tag}`, binId: f.binB, binCode: 'B1' },
    });
    expect(await onHand(1, f.binB, f.cable)).toBe(before);
  });

  it('refuses an archived bin, a missing one, and a transit bin of another pair', async () => {
    await expect(move(manager, [gain(f.archivedBin, '1')])).rejects.toMatchObject({
      details: { reason: 'stock_bin_archived' },
    });
    await expect(move(manager, [gain(newId(), '1')])).rejects.toMatchObject({
      details: { reason: 'stock_bin_missing' },
    });
    // Into the transit bin from a hub of its pair; never from a hub outside it, nor between two
    // transit bins.
    await move(manager, [
      { reason: 'transfer', entityId: 1, itemId: f.cable, fromBinId: f.binA, toBinId: f.transitBin, qty: '1' },
    ]);
    await move(manager, [
      { reason: 'transfer', entityId: 1, itemId: f.cable, fromBinId: f.transitBin, toBinId: f.otherBin, qty: '1' },
    ]);
    const stranger = await stockFixture(exec.id);
    await move(manager, [{ ...gain(stranger.binA, '2') }]);
    await expect(
      move(manager, [
        { reason: 'transfer', entityId: 1, itemId: f.cable, fromBinId: stranger.binA, toBinId: f.transitBin, qty: '1' },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_transit_pair' } });
  });

  it('refuses an inactive or archived item, and a missing one', async () => {
    await expect(move(manager, [{ ...gain(f.binA, '1'), itemId: f.inactive }])).rejects.toMatchObject({
      details: { reason: 'stock_item_inactive' },
    });
    await expect(move(manager, [{ ...gain(f.binA, '1'), itemId: f.archived }])).rejects.toMatchObject({
      details: { reason: 'stock_item_inactive' },
    });
    await expect(move(manager, [{ ...gain(f.binA, '1'), itemId: newId() }])).rejects.toMatchObject({
      details: { reason: 'stock_item_missing' },
    });
  });

  it('refuses each wrong shape of a line', async () => {
    const shapes: StockMoveLine[] = [
      // A loss into a bin, a gain out of one, a transfer with one bin, a cost on an outbound line.
      { reason: 'adjust_loss', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '1' },
      { reason: 'adjust_gain', entityId: 1, itemId: f.cable, fromBinId: f.binA, qty: '1' },
      { reason: 'transfer', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '1' },
      { reason: 'damage', entityId: 1, itemId: f.cable, fromBinId: f.binA, qty: '1', unitCost: '1.0000' },
      { reason: 'transfer', entityId: 1, itemId: f.cable, fromBinId: f.binA, toBinId: f.binA, qty: '1' },
      { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '1', refType: 'x' },
    ];
    for (const line of shapes) {
      await expect(move(manager, [line])).rejects.toMatchObject({
        details: { reason: 'stock_movement_shape' },
      });
    }
    await expect(move(manager, [])).rejects.toMatchObject({ details: { reason: 'stock_batch_empty' } });
  });

  it('a refused line refuses its whole batch', async () => {
    const before = await onHand(1, f.binA, f.cable);
    await expect(
      move(manager, [gain(f.binA, '5'), { reason: 'adjust_loss', entityId: 1, itemId: f.cable, fromBinId: f.binB, qty: '999' }]),
    ).rejects.toMatchObject({ details: { reason: 'stock_insufficient', line: 2 } });
    expect(await onHand(1, f.binA, f.cable)).toBe(before);
  });
});

describe('serials', () => {
  it('a tracked item moves one serial per movement; an untracked one none', async () => {
    await expect(
      move(manager, [{ reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1' }]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_required' } });
    await expect(
      move(manager, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '2', serialNo: serialNo() },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_qty' } });
    await expect(move(manager, [{ ...gain(f.binA, '1'), serialNo: serialNo() }])).rejects.toMatchObject({
      details: { reason: 'stock_serial_untracked' },
    });
  });

  it('keeps a serial’s state and its one bin in step with its movements', async () => {
    const no = serialNo();
    await move(manager, [
      { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo: `  ${no} ` },
    ]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'in_stock', binId: f.binA });
    // Case and spaces do not make another serial.
    await expect(
      move(manager, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binB, qty: '1', serialNo: no.toLowerCase() },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_exists' } });
    // Moved from the bin it is in, never from another.
    await expect(
      move(manager, [
        { reason: 'transfer', entityId: 1, itemId: f.pump, fromBinId: f.binB, toBinId: f.dispatch, qty: '1', serialNo: no },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_not_in_bin' } });
    await move(manager, [
      { reason: 'transfer', entityId: 1, itemId: f.pump, fromBinId: f.binA, toBinId: f.binB, qty: '1', serialNo: no },
    ]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'in_stock', binId: f.binB });
    expect(await onHand(1, f.binB, f.pump)).toBe('1.000');
    // Written off: out of every bin; a later gain of the same number brings it back.
    await move(manager, [
      { reason: 'damage', entityId: 1, itemId: f.pump, fromBinId: f.binB, qty: '1', serialNo: no },
    ]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'scrapped', binId: null });
    await expect(
      move(manager, [
        { reason: 'adjust_loss', entityId: 1, itemId: f.pump, fromBinId: f.binB, qty: '1', serialNo: no },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_not_in_bin' } });
    await move(manager, [
      { reason: 'count', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo: no },
    ]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'in_stock', binId: f.binA });
  });

  it('a count never makes a serial; an unknown number is refused', async () => {
    await expect(
      move(manager, [
        { reason: 'count', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo: serialNo() },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_unknown' } });
  });

  it('never names another company’s serial', async () => {
    const no = serialNo();
    await move(exec, [
      { reason: 'adjust_gain', entityId: 2, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo: no },
    ]);
    await expect(
      move(manager, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo: no },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_exists' } });
    const theirs = await serialOf(f.pump, no);
    await expect(
      move(manager, [
        { reason: 'transfer', entityId: 1, itemId: f.pump, fromBinId: f.binA, toBinId: f.binB, qty: '1', serialId: theirs?.id ?? null },
      ]),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_unknown' } });
  });
});

describe('the moving average (question 2 (a))', () => {
  it('a cost revalues, an issue takes the average, and a gain without a cost enters at it', async () => {
    const g = await stockFixture(exec.id);
    const cable = g.cable;
    const line = (qty: string, unitCost?: string): StockMoveLine => ({
      reason: 'adjust_gain',
      entityId: 1,
      itemId: cable,
      toBinId: g.binA,
      qty,
      unitCost: unitCost ?? null,
    });
    const [first] = await move(exec, [line('10', '100.0000')]);
    expect(await averageOf(1, cable)).toEqual({ avg: '100.0000', last: '100.0000' });
    await move(exec, [line('10', '130.0000')]);
    expect((await averageOf(1, cable)).avg).toBe('115.0000');
    const [loss] = await move(manager, [
      { reason: 'adjust_loss', entityId: 1, itemId: cable, fromBinId: g.binA, qty: '5' },
    ]);
    expect(await costOf(loss ?? '')).toBe('115.0000');
    expect((await averageOf(1, cable)).avg).toBe('115.0000');
    const [plain] = await move(manager, [line('5')]);
    expect(await costOf(plain ?? '')).toBe('115.0000');
    // A transfer keeps the average and carries it.
    const [moved] = await move(manager, [
      { reason: 'transfer', entityId: 1, itemId: cable, fromBinId: g.binA, toBinId: g.binB, qty: '3' },
    ]);
    expect(await costOf(moved ?? '')).toBe('115.0000');
    expect(await costOf(first ?? '')).toBe('100.0000');
    // Answers carry ids only.
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a gain while the company holds none takes the last positive average (STOCK-2)', async () => {
    const g = await stockFixture(exec.id);
    await move(exec, [
      { reason: 'adjust_gain', entityId: 1, itemId: g.cable, toBinId: g.binA, qty: '4', unitCost: '50.0000' },
    ]);
    await move(manager, [
      { reason: 'adjust_loss', entityId: 1, itemId: g.cable, fromBinId: g.binA, qty: '4' },
    ]);
    const [back] = await move(manager, [
      { reason: 'adjust_gain', entityId: 1, itemId: g.cable, toBinId: g.binA, qty: '2' },
    ]);
    expect(await costOf(back ?? '')).toBe('50.0000');
    expect(await averageOf(1, g.cable)).toEqual({ avg: '50.0000', last: '50.0000' });
    // Each company keeps its own average.
    expect(await averageOf(2, g.cable)).toEqual({ avg: null, last: null });
  });

  it('the reversal of a costed gain takes its value back out of the average', async () => {
    const g = await stockFixture(exec.id);
    await move(exec, [
      { reason: 'adjust_gain', entityId: 1, itemId: g.cable, toBinId: g.binA, qty: '10', unitCost: '100.0000' },
    ]);
    const [wrong] = await move(exec, [
      { reason: 'adjust_gain', entityId: 1, itemId: g.cable, toBinId: g.binA, qty: '10', unitCost: '300.0000' },
    ]);
    expect((await averageOf(1, g.cable)).avg).toBe('200.0000');
    const [undo] = await move(manager, [{ reason: 'reversal', reversesId: wrong ?? '' }]);
    expect(await costOf(undo ?? '')).toBe('300.0000');
    expect((await averageOf(1, g.cable)).avg).toBe('100.0000');
    expect(await onHand(1, g.binA, g.cable)).toBe('10.000');
  });
});

describe('reversals', () => {
  it('mirrors the movement, brings its serial back, and is never reversed itself or twice', async () => {
    const no = serialNo();
    const [inbound] = await move(manager, [
      { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo: no },
    ]);
    const [loss] = await move(manager, [
      { reason: 'adjust_loss', entityId: 1, itemId: f.pump, fromBinId: f.binA, qty: '1', serialNo: no },
    ]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'scrapped' });
    const [undo] = await move(manager, [{ reason: 'reversal', reversesId: loss ?? '' }]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'in_stock', binId: f.binA });
    await expect(move(manager, [{ reason: 'reversal', reversesId: loss ?? '' }])).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'stock_already_reversed' },
    });
    await expect(move(manager, [{ reason: 'reversal', reversesId: undo ?? '' }])).rejects.toMatchObject({
      details: { reason: 'stock_reversal_not_allowed' },
    });
    // Undoing the gain that made it takes it out again.
    await move(manager, [{ reason: 'reversal', reversesId: inbound ?? '' }]);
    expect(await serialOf(f.pump, no)).toMatchObject({ state: 'scrapped', binId: null });
  });

  it('refuses a movement of another company or one a later slice’s document reverses', async () => {
    const [theirs] = await move(exec, [{ ...gain(f.binA, '1'), entityId: 2 }]);
    await expect(move(manager, [{ reason: 'reversal', reversesId: theirs ?? '' }])).rejects.toMatchObject({
      details: { reason: 'stock_movement_missing' },
    });
    // A receipt, as U2 will post it.
    const receipt = newId();
    await asMigrator(async (m) => {
      await m`insert into stock_movements (id, entity_id, item_id, to_bin_id, qty, reason, batch_id, moved_by)
        values (${receipt}, 1, ${f.cable}, ${f.receiving}, 1, 'receipt', ${receipt}, ${exec.id})`;
      await m`insert into stock_movement_costs (movement_id, entity_id, unit_cost) values (${receipt}, 1, 1)`;
      await m`insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand)
        values (${newId()}, 1, ${f.hub}, ${f.receiving}, ${f.cable}, 1)
        on conflict (entity_id, warehouse_id, bin_id, item_id) do update set qty_on_hand = stock_balances.qty_on_hand + 1`;
    });
    await expect(move(manager, [{ reason: 'reversal', reversesId: receipt }])).rejects.toMatchObject({
      details: { reason: 'stock_reversal_not_allowed' },
    });
  });
});

describe('opening stock, once per company', () => {
  // Company 4 is this file's; the opening import's tests use company 3.
  const ENTITY = 4;

  async function reverseOpenOpenings(): Promise<void> {
    const open = await asMigrator(
      (m) => m<{ id: string }[]>`
        select m.id from stock_movements m
         where m.entity_id = ${ENTITY} and m.reason = 'opening'
           and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`,
    );
    if (open.length > 0) {
      await move(exec, open.map((o) => ({ reason: 'reversal' as const, reversesId: o.id })));
    }
  }

  beforeAll(reverseOpenOpenings);
  afterAll(reverseOpenOpenings);

  it('posts one opening batch, refuses another until the first is reversed whole', async () => {
    const opening = (qty: string): StockMoveLine => ({
      reason: 'opening',
      entityId: ENTITY,
      itemId: f.cable,
      toBinId: f.binA,
      qty,
      unitCost: '20.0000',
    });
    const ids = await move(exec, [opening('3'), opening('4')]);
    await expect(move(exec, [opening('1')])).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'opening_stock_posted', entityId: ENTITY },
    });
    // Reversed in part: still refused.
    await move(exec, [{ reason: 'reversal', reversesId: ids[0] ?? '' }]);
    await expect(move(exec, [opening('1')])).rejects.toMatchObject({
      details: { reason: 'opening_stock_posted' },
    });
    await move(exec, [{ reason: 'reversal', reversesId: ids[1] ?? '' }]);
    await move(exec, [opening('2')]);
    expect(await onHand(ENTITY, f.binA, f.cable)).toBe('2.000');
  });
});

describe('what a person without finance.cost.read reads of a movement', () => {
  it('reads the movement and never its cost', async () => {
    const [id] = await move(manager, [gain(f.binA, '1')]);
    const seen = await asPrincipal(manager, async ({ tx }) => {
      const rows = (await tx.execute(sql`
        select (select count(*)::int from stock_movements where id = ${id ?? ''}) as movements,
               (select count(*)::int from stock_movement_costs where movement_id = ${id ?? ''}) as costs
      `)) as unknown as { movements: number; costs: number }[];
      return rows[0];
    });
    expect(seen).toEqual({ movements: 1, costs: 0 });
  });
});
