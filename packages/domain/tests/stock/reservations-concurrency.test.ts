import {
  DomainError,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { fillBackorders } from '../../src/commands/inventory/reservations-jobs';
import { cancelSalesOrder } from '../../src/commands/sales/cancel-order';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { stockMove } from '../../src/stock/move';
import { reserveOrder } from '../../src/stock/reserve';
import {
  backordersOf,
  balanceOf,
  draftOrder,
  reservationFixture,
  type OrderLineSpec,
  reservationsOf,
  type ReservationFixture,
} from './reservation-fixture';
import { stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/**
 * Concurrent reservers (docs/03-roadmap-appendix/phase3.md §7.1): two orders confirmed at once for
 * the last unit reserve it once, the other backordered; a loss racing a confirmation never takes
 * the reserved unit, nor a confirmation the lost one; fills of items that share orders and lines,
 * and a cancellation beside a fill, wait for each other and never deadlock. Every path locks the
 * order, then H1's hubs, bins and balances, then the needs and the lines, and a fill takes one
 * item a transaction, so the second writer waits and then sees what the first left.
 *
 * Each race holds the first transaction open, its locks taken, until `pg_stat_activity` shows the
 * second waiting on it, so the order of the two never rests on a timer.
 */

const E = 2;
let s: StockFixture;
let f: ReservationFixture;
let lc: Principal;
let manager: Principal;
let gm: Principal;
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
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

interface Held<T> {
  /** The held transaction's server process. */
  pid: number;
  /** Lets the held transaction commit. */
  release: () => void;
  /** What the work answered, once it committed. */
  done: Promise<T>;
}

/** Runs `work` as `principal` and keeps its transaction open, its locks held, until released. */
async function holding<T>(
  principal: Principal,
  work: (context: RequestContext) => Promise<T>,
): Promise<Held<T>> {
  let held!: (pid: number) => void;
  let release!: () => void;
  const isHeld = new Promise<number>((resolve) => (held = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = asPrincipal(principal, async (context) => {
    const out = await work(context);
    const [me] = (await context.tx.execute(
      sql`select pg_backend_pid() as pid`,
    )) as unknown as { pid: number }[];
    held(me?.pid ?? 0);
    await released;
    return out;
  });
  const pid = await Promise.race([
    isHeld,
    done.then(() => {
      throw new Error('the held work finished before it was held');
    }),
  ]);
  return { pid, release, done };
}

/** Waits until another server process waits on a lock `pid` holds: 50 ms polls, at most 10 s. */
async function waitUntilBlockedBy(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await asMigrator(
      (m) => m<{ waiting: number }[]>`
        select count(*)::int as waiting
          from pg_stat_activity
         where pid <> ${pid}
           and wait_event_type = 'Lock'
           and ${pid} = any (pg_blocking_pids(pid))`,
    );
    if ((row?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error('nothing waited on the held transaction in 10 s');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

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

/** A kit of one each of the items, in the catalogue as the table owner writes it. */
async function freshKit(...itemIds: string[]): Promise<string> {
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into kits (id, sku, name)
        values (${id}, ${`RCK-${id.slice(-12)}`}, ${`Race kit ${id.slice(-12)}`})`;
      for (const itemId of itemIds) {
        await tx`insert into kit_components (id, kit_id, item_id, qty)
          values (${newId()}, ${id}, ${itemId}, 1)`;
      }
    }),
  );
  return id;
}

/** A draft order, marked confirmed by the table owner, its reservations not yet made. */
async function confirmedOrder(itemOrLines: string | readonly OrderLineSpec[]): Promise<string> {
  const lines = typeof itemOrLines === 'string' ? [{ itemId: itemOrLines, qty: '1' }] : itemOrLines;
  const { orderId } = await draftOrder(f, lc.id, lines);
  await asMigrator(
    (m) => m`update sales_orders set state = 'confirmed', confirmed_at = clock_timestamp(),
               confirmed_by = ${lc.id} where id = ${orderId}`,
  );
  return orderId;
}

/** Confirmation's reservations of a confirmed order, in a transaction of their own. */
function reserve(orderId: string) {
  return asPrincipal(lc, ({ tx }) => reserveOrder(tx, orderId, new Date()));
}

/** Confirmation's reservations, the transaction held open after they are made. */
function reserveHeld(orderId: string) {
  return holding(lc, ({ tx }) => reserveOrder(tx, orderId, new Date()));
}

/** The backorder fill of one item as `system:workers`, the transaction held open after it. */
function fillHeld(itemId: string) {
  return holding(workers(), (context) =>
    runCommand(fillBackorders, { context, audit, outbox }, { entityId: E, itemId }),
  );
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
  gm = await createTestPrincipal('general_manager', [E]);
  s = await stockFixture(exec.id);
  f = await reservationFixture(E, lc.id, '302033');
});

describe('concurrent reservers', () => {
  it('two confirmations of the last unit reserve it once; the second waits and backorders', async () => {
    const item = await freshItem();
    await gain(s.binA, item, '1');
    const first = await confirmedOrder(item);
    const second = await confirmedOrder(item);
    const held = await reserveHeld(first);
    const waiting = reserve(second);
    await waitUntilBlockedBy(held.pid);
    held.release();
    const results = await Promise.allSettled([held.done, waiting]);
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
    const held = await reserveHeld(order);
    const loss = asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_loss', entityId: E, itemId: item, fromBinId: s.binA, qty: '1' },
      ]),
    );
    await waitUntilBlockedBy(held.pid);
    held.release();
    const results = await Promise.allSettled([held.done, loss]);
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
    const loss = await holding(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_loss', entityId: E, itemId: item, fromBinId: s.binA, qty: '1' },
      ]),
    );
    const waiting = reserve(order);
    await waitUntilBlockedBy(loss.pid);
    loss.release();
    const results = await Promise.allSettled([loss.done, waiting]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await backordersOf(order)).toEqual(['1.000']);
    expect(await balanceOf(E, s.binA, item)).toEqual({ onHand: '0.000', reserved: '0.000' });
  });

  it('two fills of items that share orders and lines wait for each other and never deadlock', async () => {
    const [x, y] = [await freshItem(), await freshItem()];
    const kit = await freshKit(x, y);
    const first = await confirmedOrder([{ kitId: kit, qty: '1' }]);
    const second = await confirmedOrder([{ kitId: kit, qty: '1' }]);
    await reserve(first);
    await reserve(second);
    // Each item's queue the other way round, so the two fills meet the two lines in opposite
    // orders: the first order first for x, the second order first for y.
    await asMigrator(
      (m) => m`update reservation_needs
                  set queued_at = case when (sales_order_id = ${first}) = (item_id = ${x})
                                       then now() - interval '2 hours' else now() - interval '1 hour' end
                where sales_order_id in (${first}, ${second})`,
    );
    await gain(s.binA, x, '2');
    await gain(s.binB, y, '2');
    const held = await fillHeld(x);
    const waiting = run<{ filled: number }>(workers(), fillBackorders, { entityId: E, itemId: y });
    await waitUntilBlockedBy(held.pid);
    held.release();
    const results = await Promise.allSettled([held.done, waiting]);
    expect(results.map(reasonOf)).toEqual([undefined, undefined]);
    expect(await backordersOf(first)).toEqual(['0.000']);
    expect(await backordersOf(second)).toEqual(['0.000']);
    expect(await balanceOf(E, s.binA, x)).toEqual({ onHand: '2.000', reserved: '2.000' });
    expect(await balanceOf(E, s.binB, y)).toEqual({ onHand: '2.000', reserved: '2.000' });
  });

  it('a cancellation of an order holding one item and waiting for another waits on a fill, never deadlocks', async () => {
    const [x, y] = [await freshItem(), await freshItem()];
    await gain(s.binA, x, '1');
    // The cancelled order holds the one x and waits for y.
    const cancelled = await confirmedOrder([
      { itemId: x, qty: '1' },
      { itemId: y, qty: '1' },
    ]);
    await reserve(cancelled);
    // Another waits for x, which arrives now.
    const waitingForX = await confirmedOrder(x);
    await reserve(waitingForX);
    await gain(s.binA, x, '1');
    const fillX = await fillHeld(x);
    const cancel = run(gm, cancelSalesOrder, {
      entityId: E,
      orderId: cancelled,
      reason: 'Customer withdrew',
    });
    await waitUntilBlockedBy(fillX.pid);
    // A fill of y queues behind the cancellation, which holds its order.
    const fillY = run<{ filled: number }>(workers(), fillBackorders, { entityId: E, itemId: y });
    fillX.release();
    const results = await Promise.allSettled([fillX.done, cancel, fillY]);
    expect(results.map(reasonOf)).toEqual([undefined, undefined, undefined]);
    expect(await backordersOf(waitingForX)).toEqual(['0.000']);
    expect(await backordersOf(cancelled)).toEqual(['0.000', '0.000']);
    expect(await balanceOf(E, s.binA, x)).toEqual({ onHand: '2.000', reserved: '1.000' });
  });
});
