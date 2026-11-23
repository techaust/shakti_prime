import { type Principal } from '@shakti/contracts';
import { asPrincipal, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listHubs } from '../../src/queries/inventory/hubs';
import {
  getSerial,
  getStockCard,
  listStockBalances,
  readStockValuation,
} from '../../src/queries/inventory/stock';
import { stockMove } from '../../src/stock/move';
import { serialOf, stockFixture, type StockFixture } from '../stock/stock-fixture';

afterAll(closeDb);

/**
 * H1's reads (docs/03-roadmap-appendix/phase3.md §6.2): balances by hub, bin and item with free
 * and reserved, an item's stock card, a serial's history, and the valuation for
 * `finance.cost.read` only.
 */

let f: StockFixture;
let exec: Principal;
let manager: Principal;
const serialNo = () => `Q-${f.tag}`;

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [1]);
  f = await stockFixture(exec.id);
  await asPrincipal(exec, ({ tx }) =>
    stockMove(tx, [
      {
        reason: 'adjust_gain',
        entityId: 1,
        itemId: f.cable,
        toBinId: f.binA,
        qty: '10',
        unitCost: '100.0000',
      },
      {
        reason: 'adjust_gain',
        entityId: 1,
        itemId: f.cable,
        toBinId: f.dispatch,
        qty: '2',
        unitCost: '100.0000',
      },
      {
        reason: 'adjust_gain',
        entityId: 1,
        itemId: f.cable,
        toBinId: f.otherBin,
        qty: '4',
        unitCost: '160.0000',
      },
      {
        reason: 'adjust_gain',
        entityId: 1,
        itemId: f.pump,
        toBinId: f.binB,
        qty: '1',
        serialNo: serialNo(),
        unitCost: '5000.0000',
      },
      {
        reason: 'adjust_gain',
        entityId: 2,
        itemId: f.cable,
        toBinId: f.binA,
        qty: '7',
        unitCost: '90.0000',
      },
    ]),
  );
  // Taken out of bin A since: the card shows it first, the valuation counts it out.
  await asPrincipal(exec, ({ tx }) =>
    stockMove(tx, [
      { reason: 'adjust_loss', entityId: 1, itemId: f.cable, fromBinId: f.binA, qty: '1' },
    ]),
  );
});

describe('listStockBalances', () => {
  it('lists the company’s balances by hub, bin and item, with free stock in storage bins only', async () => {
    const page = await asPrincipal(manager, (ctx) =>
      listStockBalances(ctx, { entityId: 1, hubId: f.hub, limit: 50 }),
    );
    const mine = page.items.filter((r) => r.itemId === f.cable || r.itemId === f.pump);
    expect(mine.map((r) => [r.binCode, r.sku, r.onHand, r.free])).toEqual(
      expect.arrayContaining([
        ['A1', `SC-${f.tag}`, '9.000', '9.000'],
        ['DISPATCH', `SC-${f.tag}`, '2.000', null],
        ['B1', `SP-${f.tag}`, '1.000', '1.000'],
      ]),
    );
    // Another company's stock in the same bin is never listed.
    expect(mine.some((r) => r.onHand === '7.000')).toBe(false);
  });

  it('pages by keyset and filters by item, category and the item’s code', async () => {
    const first = await asPrincipal(manager, (ctx) =>
      listStockBalances(ctx, { entityId: 1, itemId: f.cable, limit: 2 }),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await asPrincipal(manager, (ctx) =>
      listStockBalances(ctx, {
        entityId: 1,
        itemId: f.cable,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((r) => r.binId);
    expect(new Set(ids).size).toBe(3);
    const bySku = await asPrincipal(manager, (ctx) =>
      listStockBalances(ctx, { entityId: 1, search: `sp-${f.tag}`, limit: 10 }),
    );
    expect(bySku.items.map((r) => r.itemId)).toEqual([f.pump]);
    const pumps = await asPrincipal(manager, (ctx) =>
      listStockBalances(ctx, { entityId: 1, hubId: f.hub, category: 'pump', limit: 50 }),
    );
    expect(pumps.items.every((r) => r.category === 'pump')).toBe(true);
  });

  it('is refused without inventory.stock.read for the company, and for another company', async () => {
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
        listStockBalances(ctx, { entityId: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(principalFor('field_engineer', [1]), (ctx) =>
        listStockBalances(ctx, { entityId: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(manager, (ctx) => listStockBalances(ctx, { entityId: 2 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('getStockCard and getSerial', () => {
  it('shows what each hub holds and the movements newest first, without a cost', async () => {
    const card = await asPrincipal(manager, (ctx) =>
      getStockCard(ctx, { entityId: 1, itemId: f.cable }),
    );
    expect(card.byHub.map((h) => [h.hubCode, h.onHand])).toEqual(
      [
        [`H${f.tag}`, '11.000'],
        [`O${f.tag}`, '4.000'],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(card.movements[0]).toMatchObject({
      reason: 'adjust_loss',
      qty: '1.000',
      reversible: true,
    });
    expect(card.movements[0]?.from).toMatchObject({ code: 'A1', hubCode: `H${f.tag}` });
    expect(JSON.stringify(card)).not.toMatch(/cost|100\.0000/i);
    const inHub = await asPrincipal(manager, (ctx) =>
      getStockCard(ctx, { entityId: 1, itemId: f.cable, hubId: f.otherHub }),
    );
    expect(inHub.movements).toHaveLength(1);
    // A General Manager reads it and may reverse nothing.
    const gm = await asPrincipal(principalFor('general_manager', [1]), (ctx) =>
      getStockCard(ctx, { entityId: 1, itemId: f.cable }),
    );
    expect(gm.movements.every((m) => !m.reversible)).toBe(true);
  });

  it('shows a serial where it is, with its history', async () => {
    const serial = await serialOf(f.pump, serialNo());
    const read = await asPrincipal(manager, (ctx) =>
      getSerial(ctx, { entityId: 1, serialId: serial?.id ?? '' }),
    );
    expect(read).toMatchObject({ serialNo: serialNo(), state: 'in_stock', bin: { code: 'B1' } });
    expect(read.movements).toHaveLength(1);
    await expect(
      asPrincipal(principalFor('inventory_manager', [2]), (ctx) =>
        getSerial(ctx, { entityId: 2, serialId: serial?.id ?? '' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('readStockValuation', () => {
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  it('values each hub and category from the movements’ costs, for finance.cost.read only', async () => {
    const accounts = principalFor('accounts', [1]);
    const valuation = await asPrincipal(accounts, (ctx) =>
      readStockValuation(ctx, { entityId: 1, asOf: today }),
    );
    const hub = valuation.rows.find((r) => r.hubId === f.hub && r.category === 'cable');
    // 12 in at 100 and, in the other hub, 4 at 160: the company's average is 115, so the one
    // taken out leaves at 115 (the average is per company and item, question 2 (a)).
    expect(hub).toMatchObject({ qty: '11.000', value: '1085.00', avgCost: '98.6364' });
    const other = valuation.rows.find((r) => r.hubId === f.otherHub && r.category === 'cable');
    expect(other).toMatchObject({ qty: '4.000', value: '640.00' });
    // Yesterday held none of it.
    const before = await asPrincipal(accounts, (ctx) =>
      readStockValuation(ctx, { entityId: 1, asOf: '2020-01-01' }),
    );
    expect(before.rows.find((r) => r.hubId === f.hub)).toBeUndefined();
    for (const roleKey of ['inventory_manager', 'general_manager', 'store_manager'] as const) {
      await expect(
        asPrincipal(principalFor(roleKey, [1]), (ctx) =>
          readStockValuation(ctx, { entityId: 1, asOf: today }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});

describe('listHubs', () => {
  it('lists hubs with their bins for any holder of inventory.stock.read, archived ones on request', async () => {
    const field = await asPrincipal(principalFor('field_engineer', [1]), (ctx) =>
      listHubs(ctx, {}),
    );
    const hub = field.hubs.find((h) => h.id === f.hub);
    expect(hub?.bins.map((b) => b.code)).toEqual(['A1', 'B1', 'DISPATCH', 'RECEIVING']);
    const all = await asPrincipal(manager, (ctx) => listHubs(ctx, { includeArchived: true }));
    expect(all.hubs.find((h) => h.id === f.hub)?.bins.map((b) => b.code)).toContain('Z9');
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) => listHubs(ctx, {})),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
