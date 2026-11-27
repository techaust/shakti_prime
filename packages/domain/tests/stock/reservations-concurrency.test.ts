import { DomainError, newId, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { stockMove } from '../../src/stock/move';
import { reserveOrder } from '../../src/stock/reserve';
import {
  backordersOf,
  balanceOf,
  draftOrder,
  reservationFixture,
  reservationsOf,
  type ReservationFixture,
} from './reservation-fixture';
import { stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/**
 * Concurrent reservers (docs/03-roadmap-appendix/phase3.md §7.1): two orders confirmed at once for
 * the last unit reserve it once, the other backordered; a loss racing a confirmation never takes
 * the reserved unit, nor a confirmation the lost one. Every path locks the order, then H1's hubs,
 * bins and balances, so the second writer waits and then sees what the first left.
 */

const E = 2;
let s: StockFixture;
let f: ReservationFixture;
let lc: Principal;
let manager: Principal;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freshItem(): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
      values (${id}, ${`RC-${id.slice(-12)}`}, ${`Race item ${id.slice(-12)}`}, 'pump', '8413', 'nos', false, true)`,
  );
  return id;
}

async function gain(binId: string, itemId: string, qty: string): Promise<void> {
  await asPrincipal(manager, ({ tx }) =>
    stockMove(tx, [{ reason: 'adjust_gain', entityId: E, itemId, toBinId: binId, qty }]),
  );
}

/** A draft order of one line, marked confirmed by the table owner, its reservations not yet made. */
async function confirmedOrder(itemId: string): Promise<string> {
  const { orderId } = await draftOrder(f, lc.id, [{ itemId, qty: '1' }]);
  await asMigrator(
    (m) => m`update sales_orders set state = 'confirmed', confirmed_at = clock_timestamp(),
               confirmed_by = ${lc.id} where id = ${orderId}`,
  );
  return orderId;
}

/** Confirmation's reservations in a transaction that stays open `holdMs` after they are made. */
function reserveAndHold(orderId: string, holdMs: number) {
  return asPrincipal(lc, async ({ tx }) => {
    const needs = await reserveOrder(tx, orderId, new Date());
    await tx.execute(sql`select pg_sleep(${holdMs / 1000})`);
    return needs;
  });
}

function reasonOf(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status === 'fulfilled') return undefined;
  const e: unknown = result.reason;
  if (!(e instanceof DomainError)) return String(e);
  const reason = e.details?.reason;
  return typeof reason === 'string' ? reason : e.code;
}

beforeAll(async () => {
  const exec = await createTestPrincipal('executive');
  lc = await createTestPrincipal('tele_caller_lc', [E]);
  manager = await createTestPrincipal('inventory_manager', [E]);
  s = await stockFixture(exec.id);
  f = await reservationFixture(E, lc.id, '302033');
});

describe('concurrent reservers', () => {
  it('two confirmations of the last unit reserve it once; the second waits and backorders', async () => {
    const item = await freshItem();
    await gain(s.binA, item, '1');
    const first = await confirmedOrder(item);
    const second = await confirmedOrder(item);
    const held = reserveAndHold(first, 400);
    await pause(100);
    const results = await Promise.allSettled([held, reserveAndHold(second, 0)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await backordersOf(first)).toEqual(['0.000']);
    expect(await backordersOf(second)).toEqual(['1.000']);
    expect(await balanceOf(E, s.binA, item)).toEqual({ onHand: '1.000', reserved: '1.000' });
  });

  it('two orders confirmed at once through the command never oversell', async () => {
    const item = await freshItem();
    await gain(s.binB, item, '1');
    const orders = await Promise.all(
      [1, 2, 3].map(() => draftOrder(f, lc.id, [{ itemId: item, qty: '1' }])),
    );
    const results = await Promise.allSettled(
      orders.map(({ orderId }) =>
        asPrincipal(lc, (context) =>
          runCommand(confirmSalesOrder, { context, audit, outbox }, { entityId: E, orderId }),
        ),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const active = (await Promise.all(orders.map(({ orderId }) => reservationsOf(orderId))))
      .flat()
      .filter((r) => r.state === 'active');
    expect(active.map((r) => r.qty)).toEqual(['1.000']);
    const backorders = (
      await Promise.all(orders.map(({ orderId }) => backordersOf(orderId)))
    ).flat();
    expect(backorders.sort()).toEqual(['0.000', '1.000', '1.000']);
    expect(await balanceOf(E, s.binB, item)).toEqual({ onHand: '1.000', reserved: '1.000' });
  });

  it('a loss waiting on a confirmation of the last unit is refused, never taking it', async () => {
    const item = await freshItem();
    await gain(s.binA, item, '1');
    const order = await confirmedOrder(item);
    const held = reserveAndHold(order, 400);
    await pause(100);
    const loss = asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_loss', entityId: E, itemId: item, fromBinId: s.binA, qty: '1' },
      ]),
    );
    const results = await Promise.allSettled([held, loss]);
    expect(reasonOf(results[0] as PromiseSettledResult<unknown>)).toBeUndefined();
    expect(reasonOf(results[1] as PromiseSettledResult<unknown>)).toBe(
      'stock_reserved_insufficient',
    );
    expect(await balanceOf(E, s.binA, item)).toEqual({ onHand: '1.000', reserved: '1.000' });
  });

  it('a confirmation waiting on a loss of the last unit backorders it', async () => {
    const item = await freshItem();
    await gain(s.binA, item, '1');
    const order = await confirmedOrder(item);
    const loss = asPrincipal(manager, async ({ tx }) => {
      const ids = await stockMove(tx, [
        { reason: 'adjust_loss', entityId: E, itemId: item, fromBinId: s.binA, qty: '1' },
      ]);
      await tx.execute(sql`select pg_sleep(0.4)`);
      return ids;
    });
    await pause(100);
    const results = await Promise.allSettled([loss, reserveAndHold(order, 0)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await backordersOf(order)).toEqual(['1.000']);
    expect(await balanceOf(E, s.binA, item)).toEqual({ onHand: '0.000', reserved: '0.000' });
  });
});
