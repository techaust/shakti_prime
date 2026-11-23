import { DomainError, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seededGenerator, type SeededGenerator } from '../../src/seeded-generator';
import { stockMove, type StockMoveLine } from '../../src/stock/move';
import { stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/** A refusal's catalogue reason, else its code. */
function refusalOf(e: DomainError): string {
  const reason = e.details?.reason;
  return typeof reason === 'string' ? reason : e.code;
}

/**
 * INV-02 (docs/03-roadmap-appendix/phase3.md §6.2): after 10,000 random movements, refusals among
 * them, every balance equals the sum of its movements, none is below zero, and every serial held
 * is in exactly the bin its balance counts it in. The cases repeat from the seed.
 */

const LINES = 10_000;
const SEED = 0x51a7;

let f: StockFixture;
let exec: Principal;

interface Known {
  serialNo: string;
  entityId: number;
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  f = await stockFixture(exec.id);
});

/** One random line, valid or not: the definer is the judge. */
function randomLine(
  random: SeededGenerator,
  bins: readonly string[],
  serials: Known[],
  movements: string[],
  next: () => string,
): StockMoveLine {
  const entityId = random.pick([1, 2]);
  const qty = (random.int(1, 40_000) / 1000).toFixed(3);
  const bin = () => random.pick(bins);
  const roll = random.int(1, 100);
  if (roll <= 22) {
    return {
      reason: 'adjust_gain',
      entityId,
      itemId: f.cable,
      toBinId: bin(),
      qty,
      unitCost: random.chance() ? (random.int(1, 9_999_999) / 10_000).toFixed(4) : null,
    };
  }
  if (roll <= 34) {
    return {
      reason: random.pick(['adjust_loss', 'damage'] as const),
      entityId,
      itemId: f.cable,
      fromBinId: bin(),
      qty,
    };
  }
  if (roll <= 50) {
    const from = bin();
    let to = bin();
    if (to === from) to = bins[(bins.indexOf(from) + 1) % bins.length] ?? from;
    return { reason: 'transfer', entityId, itemId: f.cable, fromBinId: from, toBinId: to, qty };
  }
  if (roll <= 56) {
    return random.chance()
      ? { reason: 'count', entityId, itemId: f.cable, toBinId: bin(), qty }
      : { reason: 'count', entityId, itemId: f.cable, fromBinId: bin(), qty };
  }
  if (roll <= 68) {
    const serialNo = next();
    serials.push({ serialNo, entityId });
    return { reason: 'adjust_gain', entityId, itemId: f.pump, toBinId: bin(), qty: '1', serialNo };
  }
  if (roll <= 84 && serials.length > 0) {
    // A known serial, moved or lost from a bin it may not be in, by a company that may not own it.
    const known = random.pick(serials);
    const owner = random.int(1, 10) === 1 ? (known.entityId === 1 ? 2 : 1) : known.entityId;
    const from = bin();
    if (random.chance()) {
      let to = bin();
      if (to === from) to = bins[(bins.indexOf(from) + 1) % bins.length] ?? from;
      return {
        reason: 'transfer',
        entityId: owner,
        itemId: f.pump,
        fromBinId: from,
        toBinId: to,
        qty: '1',
        serialNo: known.serialNo,
      };
    }
    return {
      reason: 'adjust_loss',
      entityId: owner,
      itemId: f.pump,
      fromBinId: from,
      qty: '1',
      serialNo: known.serialNo,
    };
  }
  if (roll <= 95 && movements.length > 0) {
    return { reason: 'reversal', reversesId: random.pick(movements) };
  }
  // Refused whatever the stock: an inactive item, an archived bin, a reason not open yet.
  return random.pick<StockMoveLine>([
    { reason: 'adjust_gain', entityId, itemId: f.inactive, toBinId: bin(), qty },
    { reason: 'adjust_gain', entityId, itemId: f.cable, toBinId: f.archivedBin, qty },
    { reason: 'issue', entityId, itemId: f.cable, fromBinId: bin(), qty },
  ]);
}

describe('balances equal movements (INV-02)', () => {
  it(`holds after ${LINES.toLocaleString('en-IN')} random movements, refusals included`, async () => {
    const random = seededGenerator(SEED);
    const bins = [f.binA, f.binB, f.receiving, f.dispatch, f.otherBin, f.transitBin];
    const serials: Known[] = [];
    const movements: string[] = [];
    let seq = 0;
    const next = () => `PT-${f.tag}-${String((seq += 1))}`;
    let lines = 0;
    let posted = 0;
    const refusals = new Map<string, number>();
    while (lines < LINES) {
      // Most batches are one line; some carry up to four, which one refusal turns back whole.
      const size = Math.min(random.int(1, 10) <= 7 ? 1 : random.int(2, 4), LINES - lines);
      const batch = Array.from({ length: size }, () =>
        randomLine(random, bins, serials, movements, next),
      );
      lines += size;
      try {
        const ids = await asPrincipal(exec, ({ tx }) => stockMove(tx, batch));
        movements.push(...ids);
        posted += ids.length;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        const reason = refusalOf(e);
        refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
      }
    }
    // Both outcomes happened, many times over.
    expect(posted).toBeGreaterThan(LINES / 4);
    expect(refusals.get('stock_insufficient') ?? 0).toBeGreaterThan(50);
    expect(refusals.get('stock_serial_not_in_bin') ?? 0).toBeGreaterThan(10);
    expect(refusals.get('stock_already_reversed') ?? 0).toBeGreaterThan(0);

    // The definer's own check, as the workers principal reads it, finds nothing.
    const differ = await asPrincipal(
      principalFor('system:workers'),
      async ({ tx }) =>
        (await tx.execute(sql`
          select count(*)::int as n from app.stock_balance_check() c
           where c.item_id in (${f.cable}, ${f.pump})`)) as unknown as { n: number }[],
    );
    expect(differ[0]?.n).toBe(0);

    // And recomputed independently: each balance against its movements, every bin of the file.
    const rows = await asMigrator(
      (m) => m<{ bin: string; item: string; entity: number; held: string; moved: string }[]>`
          select b.bin_id as bin, b.item_id as item, b.entity_id as entity,
                 b.qty_on_hand::text as held,
                 (coalesce((select sum(qty) from stock_movements where entity_id = b.entity_id
                              and item_id = b.item_id and to_bin_id = b.bin_id), 0)
                  - coalesce((select sum(qty) from stock_movements where entity_id = b.entity_id
                                and item_id = b.item_id and from_bin_id = b.bin_id), 0))::numeric(12, 3)::text as moved
            from stock_balances b where b.item_id in (${f.cable}, ${f.pump})`,
    );
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.held).toBe(row.moved);
      expect(Number(row.held)).toBeGreaterThanOrEqual(0);
    }

    // A serial held is in one bin, and its bin's balance counts exactly the serials it holds.
    const serialRows = await asMigrator(
      (m) => m<{ bin: string; entity: number; serials: number; held: string }[]>`
          select b.bin_id as bin, b.entity_id as entity, b.qty_on_hand::text as held,
                 (select count(*)::int from serials s where s.item_id = b.item_id
                    and s.entity_id = b.entity_id and s.bin_id = b.bin_id and s.state = 'in_stock') as serials
            from stock_balances b where b.item_id = ${f.pump}`,
    );
    for (const row of serialRows) expect(Number(row.held)).toBe(row.serials);
    const [loose] = await asMigrator(
      (m) => m<{ n: number }[]>`
          select count(*)::int as n from serials
           where item_id = ${f.pump} and ((state = 'in_stock') <> (bin_id is not null))`,
    );
    expect(loose?.n).toBe(0);

    // No average below zero.
    const [negative] = await asMigrator(
      (m) => m<{ n: number }[]>`
          select count(*)::int as n from item_costs
           where item_id in (${f.cable}, ${f.pump})
             and (moving_avg_cost < 0 or last_positive_avg_cost <= 0)`,
    );
    expect(negative?.n).toBe(0);
  }, 600_000);
});
