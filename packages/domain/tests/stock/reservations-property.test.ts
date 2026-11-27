import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { releaseReservation } from '../../src/commands/inventory/reservations';
import { fillBackorders, scanReservations } from '../../src/commands/inventory/reservations-jobs';
import { cancelSalesOrder } from '../../src/commands/sales/cancel-order';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { seededGenerator } from '../../src/seeded-generator';
import { kitAvailability } from '../../src/stock/atp';
import { stockMove } from '../../src/stock/move';
import { draftOrder, reservationFixture, type ReservationFixture } from './reservation-fixture';
import { stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/**
 * The reservation property (docs/03-roadmap-appendix/phase3.md §7.1): after any run of random
 * confirmations, cancellations, lapses, releases, gains, losses and fills, every bin's
 * `qty_reserved` equals its active reservations and never exceeds what it holds; every need of an
 * open order is its reservations plus its backorder, and a cancelled order holds and waits for
 * nothing; each line's backorder is what its needs leave (a kit line's, the kits its holds do not
 * make whole, as atp.ts's `kitAvailability()` counts them); once the fill has run, no backorder
 * queued at its order's confirmation waits while some of its item is free; and the needs put back
 * on order by a lapse or a release by hand share the stock that entered storage after them, each
 * arrived unit given to at most one of them, in queue order.
 */

const E = 2;
const STEPS = 60;
let s: StockFixture;
let f: ReservationFixture;
let lc: Principal;
let gm: Principal;
let manager: Principal;
let items: string[];
let kit: string;
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

beforeAll(async () => {
  const exec = await createTestPrincipal('executive');
  lc = await createTestPrincipal('tele_caller_lc', [E]);
  gm = await createTestPrincipal('general_manager', [E]);
  manager = await createTestPrincipal('inventory_manager', [E]);
  s = await stockFixture(exec.id);
  f = await reservationFixture(E, lc.id, '302034');
  items = [newId(), newId()];
  kit = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (const [i, id] of items.entries()) {
        await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
          values (${id}, ${`RQ-${f.tag}-${String(i)}`}, ${`Property item ${f.tag} ${String(i)}`},
                  'pump', '8413', 'nos', false, true)`;
      }
      await tx`insert into kits (id, sku, name) values (${kit}, ${`RQK-${f.tag}`}, ${`Property kit ${f.tag}`})`;
      await tx`insert into kit_components (id, kit_id, item_id, qty) values
        (${newId()}, ${kit}, ${items[0] ?? ''}, 2), (${newId()}, ${kit}, ${items[1] ?? ''}, 1)`;
    }),
  );
  // The other hub serves the site, so orders take from it first.
  await asMigrator(
    (m) => m`update warehouses set pin_codes = ${[f.sitePin]} where id = ${s.otherHub}`,
  );
});

interface Violation {
  rule: string;
  row: unknown;
}

/** Every rule of the property, read by the table owner over this file's items and orders. */
async function violations(
  orders: readonly string[],
  firstRequeue: ReadonlyMap<string, string>,
): Promise<Violation[]> {
  return asMigrator(async (m) => {
    const found: Violation[] = [];
    const bins = await m`
      select b.bin_id, b.item_id, b.qty_on_hand, b.qty_reserved,
             coalesce((select sum(r.qty) from reservations r
                        where r.entity_id = b.entity_id and r.bin_id = b.bin_id
                          and r.item_id = b.item_id and r.state = 'active'), 0) as active
        from stock_balances b
       where b.entity_id = ${E} and b.item_id = any (${items}::uuid[])`;
    for (const b of bins) {
      if (Number(b.qty_reserved) !== Number(b.active))
        found.push({ rule: 'reserved = active', row: b });
      if (Number(b.qty_reserved) > Number(b.qty_on_hand))
        found.push({ rule: 'reserved <= on hand', row: b });
    }
    if (orders.length === 0) return found;
    const needs = await m`
      select n.id, so.state, n.qty_needed, n.qty_backordered,
             coalesce((select sum(r.qty) from reservations r
                        where r.sales_order_line_id = n.sales_order_line_id and r.item_id = n.item_id
                          and r.state in ('active', 'picked')), 0) as held
        from reservation_needs n join sales_orders so on so.id = n.sales_order_id
       where n.sales_order_id = any (${orders}::uuid[])`;
    for (const n of needs) {
      if (n.state === 'cancelled') {
        if (Number(n.qty_backordered) !== 0 || Number(n.held) !== 0) {
          found.push({ rule: 'a cancelled order holds and waits for nothing', row: n });
        }
      } else if (Number(n.qty_needed) !== Number(n.qty_backordered) + Number(n.held)) {
        found.push({ rule: 'needed = held + backordered', row: n });
      }
    }
    const lines = await m`
      select l.id, l.kit_id, l.qty, l.qty_backordered,
             (select json_agg(json_build_object('needed', n.qty_needed, 'short', n.qty_backordered))
                from reservation_needs n where n.sales_order_line_id = l.id) as needs
        from sales_order_lines l where l.sales_order_id = any (${orders}::uuid[])`;
    for (const l of lines) {
      const list = ((l.needs ?? []) as { needed: number | string; short: number | string }[]).map(
        (n) => ({ needed: Number(n.needed), short: Number(n.short) }),
      );
      const qty = Number(l.qty);
      let expected = 0;
      if (list.length > 0 && list.some((n) => n.short > 0)) {
        if (l.kit_id === null) {
          expected = list[0]?.short ?? 0;
        } else {
          // Each component per kit, and what of it is held, in thousandths.
          const parts = list.map((n, i) => ({
            itemId: String(i),
            perKit: Math.round((n.needed * 1000) / qty),
          }));
          const held = new Map(list.map((n, i) => [String(i), Math.round((n.needed - n.short) * 1000)]));
          expected = qty - Math.min(qty, kitAvailability(parts, held).kits);
        }
      }
      if (Math.abs(Number(l.qty_backordered) - expected) > 0.0005) {
        found.push({ rule: 'a line’s backorder is what its needs leave', row: l });
      }
    }
    const waiting = await m`
      select n.item_id, sum(n.qty_backordered) as short,
             (select coalesce(sum(b.qty_on_hand - b.qty_reserved), 0)
                from stock_balances b join bins x on x.id = b.bin_id and x.kind = 'storage'
               where b.entity_id = ${E} and b.item_id = n.item_id) as free
        from reservation_needs n join sales_orders so on so.id = n.sales_order_id
       where n.sales_order_id = any (${orders}::uuid[]) and so.state = 'confirmed'
         and n.qty_backordered > 0 and n.requeued_at is null
       group by n.item_id`;
    for (const w of waiting) {
      if (Number(w.free) > 0) {
        found.push({ rule: 'no backorder queued at confirmation waits beside free stock', row: w });
      }
    }
    // The re-queued needs share one pool: what the fill gave them, whatever became of it, is never
    // more than what entered storage after the item's first re-queue.
    for (const [itemId, since] of firstRequeue) {
      const [pool] = await m`
        select coalesce((select sum(r.qty) from reservations r
                          where r.entity_id = ${E} and r.item_id = ${itemId} and r.from_arrivals), 0)
                 as given,
               coalesce((select sum(mv.qty) from stock_movements mv
                           join bins tb on tb.id = mv.to_bin_id and tb.kind = 'storage'
                           left join bins fb on fb.id = mv.from_bin_id
                          where mv.entity_id = ${E} and mv.item_id = ${itemId}
                            and mv.moved_at > ${since}::timestamptz
                            and (fb.id is null or fb.kind <> 'storage')), 0) as arrived`;
      if (pool && Number(pool.given) > Number(pool.arrived)) {
        found.push({ rule: 'each unit that arrived after a re-queue is given once', row: pool });
      }
    }
    return found;
  });
}

/** Keeps, per item, the earliest moment any of the orders' needs was put back on order. */
async function noteRequeues(orders: readonly string[], firstRequeue: Map<string, string>) {
  if (orders.length === 0) return;
  const rows = await asMigrator(
    (m) => m<{ itemId: string; since: string }[]>`
      select item_id as "itemId", min(requeued_at)::text as since from reservation_needs
       where sales_order_id = any (${orders}::uuid[]) and requeued_at is not null
       group by item_id`,
  );
  for (const r of rows) {
    const known = firstRequeue.get(r.itemId);
    if (known === undefined || new Date(r.since) < new Date(known)) {
      firstRequeue.set(r.itemId, r.since);
    }
  }
}

async function fillAll(): Promise<void> {
  for (const itemId of items) await run(workers(), fillBackorders, { entityId: E, itemId });
}

describe('reservations under random confirmations, cancellations, lapses, releases and fills', () => {
  it(`keep every balance, need and line in step over ${String(STEPS)} steps`, async () => {
    const random = seededGenerator(0x52e5);
    const bins = [s.binA, s.binB, s.otherBin];
    const orders: string[] = [];
    const open: string[] = [];
    const firstRequeue = new Map<string, string>();
    for (let step = 0; step < STEPS; step += 1) {
      const action = random.pick([
        'gain',
        'gain',
        'confirm',
        'confirm',
        'cancel',
        'lapse',
        'release',
        'loss',
      ]);
      const item = random.pick(items);
      if (action === 'gain') {
        await asPrincipal(manager, ({ tx }) =>
          stockMove(tx, [
            {
              reason: 'adjust_gain',
              entityId: E,
              itemId: item,
              toBinId: random.pick(bins),
              qty: String(random.int(1, 4)),
            },
          ]),
        );
      } else if (action === 'confirm') {
        const lines = Array.from({ length: random.int(1, 2) }, () =>
          random.chance()
            ? { kitId: kit, qty: String(random.int(1, 2)) }
            : { itemId: random.pick(items), qty: String(random.int(1, 4)) },
        );
        const { orderId } = await draftOrder(f, lc.id, lines);
        await run(lc, confirmSalesOrder, { entityId: E, orderId });
        orders.push(orderId);
        open.push(orderId);
      } else if (action === 'cancel' && open.length > 0) {
        const orderId = random.pick(open);
        open.splice(open.indexOf(orderId), 1);
        await run(gm, cancelSalesOrder, { entityId: E, orderId, reason: 'Property run cancel' });
      } else if ((action === 'lapse' || action === 'release') && open.length > 0) {
        const orderId = random.pick(open);
        const active = await asMigrator(
          (m) => m<{ id: string }[]>`
            select id from reservations where sales_order_id = ${orderId} and state = 'active'
             order by id`,
        );
        const target = active.length > 0 ? random.pick(active) : undefined;
        if (target && action === 'lapse') {
          await asMigrator(
            (m) =>
              m`update reservations set expires_at = now() - interval '1 second' where id = ${target.id}`,
          );
          await run(workers(), scanReservations, { entityId: E });
        } else if (target) {
          await run(manager, releaseReservation, {
            entityId: E,
            reservationId: target.id,
            reason: 'Property run release',
          });
        }
      } else if (action === 'loss') {
        // May be refused: the bin holds too little, or what it holds is reserved.
        await asPrincipal(manager, ({ tx }) =>
          stockMove(tx, [
            {
              reason: 'adjust_loss',
              entityId: E,
              itemId: item,
              fromBinId: random.pick(bins),
              qty: String(random.int(1, 3)),
            },
          ]),
        ).catch(() => undefined);
      }
      // The fill runs after anything that brings or frees stock, as the worker does.
      await fillAll();
      await noteRequeues(orders, firstRequeue);
      expect(await violations(orders, firstRequeue), `step ${String(step)} (${action})`).toEqual(
        [],
      );
    }
    expect(orders.length).toBeGreaterThan(5);
  });
});

describe('needs put back on order', () => {
  it('share what arrives after them: never more than arrived, and in queue order', async () => {
    const random = seededGenerator(0x7e9);
    for (let round = 0; round < 6; round += 1) {
      const item = newId();
      await asMigrator(
        (m) => m`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
          values (${item}, ${`RQP-${f.tag}-${String(round)}`}, ${`Pool item ${f.tag} ${String(round)}`},
                  'pump', '8413', 'nos', false, true)`,
      );
      // N orders hold all the stock, then every hold lapses, oldest first.
      const sizes = Array.from({ length: random.int(2, 4) }, () => random.int(1, 2));
      await asPrincipal(manager, ({ tx }) =>
        stockMove(tx, [
          {
            reason: 'adjust_gain',
            entityId: E,
            itemId: item,
            toBinId: s.binA,
            qty: String(sizes.reduce((a, b) => a + b, 0)),
          },
        ]),
      );
      const orders: string[] = [];
      for (const qty of sizes) {
        const { orderId } = await draftOrder(f, lc.id, [{ itemId: item, qty: String(qty) }]);
        await run(lc, confirmSalesOrder, { entityId: E, orderId });
        orders.push(orderId);
      }
      for (const orderId of orders) {
        await asMigrator(
          (m) => m`update reservations set expires_at = now() - interval '1 second'
                    where sales_order_id = ${orderId} and state = 'active'`,
        );
        await run(workers(), scanReservations, { entityId: E });
      }
      // K arrivals of any size, each followed by a fill or not, then a last fill.
      let arrived = 0;
      for (let k = random.int(1, 4); k > 0; k -= 1) {
        const qty = random.int(1, 3);
        arrived += qty;
        await asPrincipal(manager, ({ tx }) =>
          stockMove(tx, [
            {
              reason: 'adjust_gain',
              entityId: E,
              itemId: item,
              toBinId: random.pick([s.binA, s.binB, s.otherBin]),
              qty: String(qty),
            },
          ]),
        );
        if (random.chance()) await run(workers(), fillBackorders, { entityId: E, itemId: item });
        await expectShared(orders, arrived, `round ${String(round)}`);
      }
      await run(workers(), fillBackorders, { entityId: E, itemId: item });
      await expectShared(orders, arrived, `round ${String(round)}, last fill`);
      // With the fill run last, what arrived is all given, up to what the orders wait for.
      const total = sizes.reduce((a, b) => a + b, 0);
      expect(await heldSinceLapse(orders), `round ${String(round)}`).toBe(Math.min(arrived, total));
      // The item leaves the catalogue's lists, which other files read the first 200 of.
      await asMigrator((m) => m`update items set archived_at = now() where id = ${item}`);
    }
  });
});

/** What the orders hold now, all of it taken after their holds lapsed. */
async function heldSinceLapse(orders: readonly string[]): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ held: string }[]>`
      select coalesce(sum(qty), 0)::text as held from reservations
       where sales_order_id = any (${orders}::uuid[]) and state = 'active'`,
  );
  return Number(row?.held ?? 0);
}

/**
 * The orders, oldest re-queue first, hold no more than `arrived` together, and no order holds
 * anything while an order before it in the queue still waits.
 */
async function expectShared(orders: readonly string[], arrived: number, label: string) {
  const needs = await asMigrator(
    (m) => m<{ held: string; waiting: string }[]>`
      select coalesce((select sum(r.qty) from reservations r
                        where r.sales_order_line_id = n.sales_order_line_id
                          and r.item_id = n.item_id and r.state = 'active'), 0)::text as held,
             n.qty_backordered::text as waiting
        from reservation_needs n
       where n.sales_order_id = any (${orders}::uuid[])
       order by n.queued_at, n.id`,
  );
  expect(needs.reduce((sum, n) => sum + Number(n.held), 0), label).toBeLessThanOrEqual(arrived);
  const firstWaiting = needs.findIndex((n) => Number(n.waiting) > 0);
  if (firstWaiting >= 0) {
    for (const later of needs.slice(firstWaiting + 1)) expect(Number(later.held), label).toBe(0);
  }
}

