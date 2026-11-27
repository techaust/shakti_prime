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
import { stockMove } from '../../src/stock/move';
import { draftOrder, reservationFixture, type ReservationFixture } from './reservation-fixture';
import { stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/**
 * The reservation property (docs/03-roadmap-appendix/phase3.md §7.1): after any run of random
 * confirmations, cancellations, lapses, releases, gains, losses and fills, every bin's
 * `qty_reserved` equals its active reservations and never exceeds what it holds; every need of an
 * open order is its reservations plus its backorder, and a cancelled order holds and waits for
 * nothing; each line's backorder is what its needs leave; and once the fill has run, no backorder
 * of an item waits while some of it is free.
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
async function violations(orders: readonly string[]): Promise<Violation[]> {
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
      const list = (l.needs ?? []) as { needed: number; short: number }[];
      const qty = Number(l.qty);
      let expected = 0;
      if (list.length > 0 && list.some((n) => Number(n.short) > 0)) {
        expected =
          l.kit_id === null
            ? Number(list[0]?.short ?? 0)
            : qty -
              Math.min(
                qty,
                Math.floor(
                  Math.min(
                    ...list.map(
                      (n) => ((Number(n.needed) - Number(n.short)) * qty) / Number(n.needed),
                    ),
                  ),
                ),
              );
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
         and n.qty_backordered > 0
       group by n.item_id`;
    for (const w of waiting) {
      if (Number(w.free) > 0) found.push({ rule: 'no backorder waits beside free stock', row: w });
    }
    return found;
  });
}

async function fillAll(): Promise<void> {
  await run(workers(), fillBackorders, { entityId: E, itemIds: items });
}

describe('reservations under random confirmations, cancellations, lapses, releases and fills', () => {
  it(`keep every balance, need and line in step over ${String(STEPS)} steps`, async () => {
    const random = seededGenerator(0x52e5);
    const bins = [s.binA, s.binB, s.otherBin];
    const orders: string[] = [];
    const open: string[] = [];
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
      expect(await violations(orders), `step ${String(step)} (${action})`).toEqual([]);
    }
    expect(orders.length).toBeGreaterThan(5);
  });
});
