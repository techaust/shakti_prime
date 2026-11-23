import { DomainError, type Principal } from '@shakti/contracts';
import { asPrincipal, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seededGenerator } from '../../src/seeded-generator';
import { stockMove, type StockMoveLine } from '../../src/stock/move';
import { onHand, serialOf, stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/** A refusal's catalogue reason, else its code. */
function refusalOf(e: DomainError): string {
  const reason = e.details?.reason;
  return typeof reason === 'string' ? reason : e.code;
}

/**
 * Concurrent writers (docs/03-roadmap-appendix/phase3.md §6.2): two issues of the last unit leave
 * one refused; two moves of one serial leave it in one bin; writers crossing the same bins and
 * items in opposite orders never deadlock, since every path locks in one order.
 */

let f: StockFixture;
let manager: Principal;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Posts `lines` in a transaction that stays open `holdMs` after the definer answers, so a second
 * writer started meanwhile has to wait for its locks.
 */
function postAndHold(lines: readonly StockMoveLine[], holdMs: number): Promise<string[]> {
  return asPrincipal(manager, async ({ tx }) => {
    const ids = await stockMove(tx, lines);
    await tx.execute(sql`select pg_sleep(${holdMs / 1000})`);
    return ids;
  });
}

function reasonOf(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status === 'fulfilled') return undefined;
  const e: unknown = result.reason;
  return e instanceof DomainError ? refusalOf(e) : String(e);
}

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager', [1]);
  const exec = await createTestPrincipal('executive');
  f = await stockFixture(exec.id);
});

describe('concurrent writers', () => {
  it('two concurrent issues of the last unit leave one refused', async () => {
    await asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '1' },
      ]),
    );
    const loss: StockMoveLine = {
      reason: 'adjust_loss',
      entityId: 1,
      itemId: f.cable,
      fromBinId: f.binA,
      qty: '1',
    };
    const results = await Promise.allSettled([
      postAndHold([loss], 400),
      pause(100).then(() => postAndHold([loss], 0)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.map(reasonOf).filter(Boolean)).toEqual(['stock_insufficient']);
    expect(await onHand(1, f.binA, f.cable)).toBe('0.000');
  });

  it('two concurrent moves of one serial leave it in one bin', async () => {
    const serialNo = `CC-${f.tag}-1`;
    await asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo },
      ]),
    );
    const to = (bin: string): StockMoveLine => ({
      reason: 'transfer',
      entityId: 1,
      itemId: f.pump,
      fromBinId: f.binA,
      toBinId: bin,
      qty: '1',
      serialNo,
    });
    const results = await Promise.allSettled([
      postAndHold([to(f.binB)], 400),
      pause(100).then(() => postAndHold([to(f.dispatch)], 0)),
    ]);
    expect(results.map(reasonOf).filter(Boolean)).toEqual(['stock_serial_not_in_bin']);
    expect(await serialOf(f.pump, serialNo)).toMatchObject({ state: 'in_stock', binId: f.binB });
    expect(await onHand(1, f.binB, f.pump)).toBe('1.000');
    expect(await onHand(1, f.dispatch, f.pump)).toBe('0.000');
  });

  it('writers crossing the same bins in opposite orders never deadlock', async () => {
    await asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '500' },
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binB, qty: '500' },
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.receiving, qty: '500' },
      ]),
    );
    const bins = [f.binA, f.binB, f.receiving];
    const worker = async (seed: number) => {
      const random = seededGenerator(seed);
      const outcomes: string[] = [];
      for (let i = 0; i < 15; i += 1) {
        // Each batch walks the bins in its own order, both ways, so two batches cross.
        const order = random.chance() ? bins : [...bins].reverse();
        const batch: StockMoveLine[] = order.slice(0, -1).map((from, k) => ({
          reason: 'transfer',
          entityId: 1,
          itemId: f.cable,
          fromBinId: from,
          toBinId: order[k + 1] ?? from,
          qty: String(random.int(1, 30)),
        }));
        try {
          await asPrincipal(manager, ({ tx }) => stockMove(tx, batch));
          outcomes.push('ok');
        } catch (e) {
          outcomes.push(e instanceof DomainError ? refusalOf(e) : String(e));
        }
      }
      return outcomes;
    };
    const outcomes = (await Promise.all([1, 2, 3, 4, 5, 6].map(worker))).flat();
    expect(outcomes.filter((o) => o !== 'ok' && o !== 'stock_insufficient')).toEqual([]);
    expect(outcomes.filter((o) => o === 'ok').length).toBeGreaterThan(60);
    const differ = await asPrincipal(
      principalFor('system:workers'),
      async ({ tx }) =>
        (await tx.execute(sql`
        select count(*)::int as n from app.stock_balance_check() c where c.item_id = ${f.cable}`)) as unknown as {
          n: number;
        }[],
    );
    expect(differ[0]?.n).toBe(0);
    const total = (await Promise.all(bins.map((b) => onHand(1, b, f.cable)))).reduce(
      (sum, q) => sum + Number(q),
      0,
    );
    expect(total).toBe(1500);
  });
});
