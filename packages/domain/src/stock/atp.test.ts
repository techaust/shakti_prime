import { describe, expect, it } from 'vitest';
import { forAllSeeded } from '../seeded-generator';
import {
  fromThousandths,
  itemAvailability,
  kitAvailability,
  lineAvailability,
  toThousandths,
  type BalanceFacts,
  type KitComponent,
} from './atp';

const KINDS = ['storage', 'receiving', 'dispatch', 'quarantine', 'surplus', 'transit'] as const;

describe('itemAvailability', () => {
  it('counts on hand less reserved in storage bins only', () => {
    const balances: BalanceFacts[] = [
      { hubId: 'a', binKind: 'storage', onHand: 10_000, reserved: 4_000 },
      { hubId: 'a', binKind: 'receiving', onHand: 50_000, reserved: 0 },
      { hubId: 'b', binKind: 'storage', onHand: 3_000, reserved: 0 },
      { hubId: 'b', binKind: 'quarantine', onHand: 2_000, reserved: 0 },
      { hubId: 'b', binKind: 'dispatch', onHand: 1_000, reserved: 0 },
      { hubId: 't', binKind: 'transit', onHand: 7_000, reserved: 0 },
    ];
    expect(itemAvailability(balances)).toBe(9_000);
    expect(itemAvailability(balances, { hubId: 'a' })).toBe(6_000);
    expect(itemAvailability(balances, { hubId: 'c' })).toBe(0);
  });

  it('is the sum of each storage bin’s free stock, never below zero, on generated balances', () => {
    forAllSeeded(0x4a2, 500, (r) => {
      const balances: BalanceFacts[] = Array.from({ length: r.int(0, 12) }, () => {
        const onHand = r.int(0, 20_000);
        return {
          hubId: r.pick(['a', 'b', 'c']),
          binKind: r.pick(KINDS),
          onHand,
          reserved: r.int(0, onHand),
        };
      });
      const all = itemAvailability(balances);
      const byHub = ['a', 'b', 'c'].reduce(
        (sum, hubId) => sum + itemAvailability(balances, { hubId }),
        0,
      );
      expect(all).toBe(byHub);
      expect(all).toBeGreaterThanOrEqual(0);
      const storageOnHand = balances
        .filter((b) => b.binKind === 'storage')
        .reduce((s, b) => s + b.onHand, 0);
      expect(all).toBeLessThanOrEqual(storageOnHand);
    });
  });
});

describe('kitAvailability', () => {
  it('takes the floor of each component’s free stock over its quantity per kit', () => {
    const components: KitComponent[] = [
      { itemId: 'panel', perKit: 4_000 },
      { itemId: 'inverter', perKit: 1_000 },
      { itemId: 'cable', perKit: 25_500 },
    ];
    const free = new Map([
      ['panel', 18_000],
      ['inverter', 9_000],
      ['cable', 100_000],
    ]);
    expect(kitAvailability(components, free)).toEqual({ kits: 3, limitingItemId: 'cable' });
    expect(kitAvailability(components, new Map([['panel', 40_000]]))).toEqual({
      kits: 0,
      limitingItemId: 'inverter',
    });
    expect(kitAvailability([], free)).toEqual({
      kits: Number.POSITIVE_INFINITY,
      limitingItemId: null,
    });
    expect(() => kitAvailability([{ itemId: 'x', perKit: 0 }], free)).toThrow(RangeError);
  });

  it('makes no more kits than any component allows, and one more kit is short of the limit, on generated kits', () => {
    forAllSeeded(0x6b1, 1_000, (r) => {
      const components: KitComponent[] = Array.from({ length: r.int(1, 6) }, (_, i) => ({
        itemId: `c${String(i)}`,
        perKit: r.int(1, 30) * r.pick([1, 10, 100, 1000]),
      }));
      const free = new Map(components.map((c) => [c.itemId, r.int(0, 60_000)]));
      const { kits, limitingItemId } = kitAvailability(components, free);
      for (const c of components) {
        expect(kits * c.perKit).toBeLessThanOrEqual(free.get(c.itemId) ?? 0);
      }
      const limit = components.find((c) => c.itemId === limitingItemId);
      expect(limit).toBeDefined();
      if (limit) expect((kits + 1) * limit.perKit).toBeGreaterThan(free.get(limit.itemId) ?? 0);
    });
  });
});

describe('lineAvailability', () => {
  it('is covered, partly covered or short by what is available', () => {
    expect(lineAvailability(5_000, 5_000)).toEqual({ status: 'covered', expectedOn: null });
    expect(lineAvailability(5_000, 9_000)).toEqual({ status: 'covered', expectedOn: null });
    expect(lineAvailability(5_000, 1)).toEqual({ status: 'partly_covered', expectedOn: null });
    expect(lineAvailability(5_000, 0)).toEqual({ status: 'short', expectedOn: null });
  });

  it('names the date the earliest open purchases cover the rest', () => {
    const purchases = [
      { qty: 2_000, expectedOn: '2026-12-20' },
      { qty: 1_000, expectedOn: '2026-12-05' },
    ];
    expect(lineAvailability(4_000, 1_000, purchases)).toEqual({
      status: 'partly_covered',
      expectedOn: '2026-12-20',
    });
    expect(lineAvailability(2_000, 1_000, purchases)).toEqual({
      status: 'partly_covered',
      expectedOn: '2026-12-05',
    });
    expect(lineAvailability(9_000, 0, purchases)).toEqual({ status: 'short', expectedOn: null });
  });

  it('agrees with what is available on generated lines', () => {
    forAllSeeded(0x7c3, 1_000, (r) => {
      const qty = r.int(1, 50_000);
      const available = r.chance() ? r.int(0, qty) : r.int(0, 100_000);
      const purchases = Array.from({ length: r.int(0, 4) }, () => ({
        qty: r.int(1, 20_000),
        expectedOn: `2026-12-${String(r.int(1, 28)).padStart(2, '0')}`,
      }));
      const { status, expectedOn } = lineAvailability(qty, available, purchases);
      expect(status).toBe(available >= qty ? 'covered' : available > 0 ? 'partly_covered' : 'short');
      if (status === 'covered') expect(expectedOn).toBeNull();
      if (expectedOn !== null) {
        const due = purchases.filter((p) => p.expectedOn <= expectedOn);
        expect(available + due.reduce((s, p) => s + p.qty, 0)).toBeGreaterThanOrEqual(qty);
      } else if (status !== 'covered') {
        expect(available + purchases.reduce((s, p) => s + p.qty, 0)).toBeLessThan(qty);
      }
    });
  });
});

describe('thousandths', () => {
  it('read and write the ledger’s quantities', () => {
    expect(toThousandths('12.5')).toBe(12_500);
    expect(toThousandths('0.001')).toBe(1);
    expect(toThousandths('7')).toBe(7_000);
    expect(fromThousandths(12_500)).toBe('12.500');
    expect(fromThousandths(0)).toBe('0.000');
    expect(() => toThousandths('-1')).toThrow(RangeError);
    expect(() => fromThousandths(1.5)).toThrow(RangeError);
  });
});
