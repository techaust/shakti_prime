import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type LineAvailabilityDto,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import type { RequestContext } from '@shakti/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  extendReservation,
  moveReservation,
  releaseReservation,
} from '../../src/commands/inventory/reservations';
import { fillBackorders, scanReservations } from '../../src/commands/inventory/reservations-jobs';
import { notifyEvent } from '../../src/commands/notifications/notify';
import { cancelSalesOrder } from '../../src/commands/sales/cancel-order';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  previewLineAvailability,
  readLineAvailability,
} from '../../src/queries/inventory/availability';
import { listItemBackorders, listReservations } from '../../src/queries/inventory/reservations';
import { stockMove } from '../../src/stock/move';
import { WORKSHOP_DEFAULTS } from '../../src/workshop-defaults';
import {
  backordersOf,
  balanceOf,
  draftOrder,
  reservationFixture,
  reservationsOf,
  type ReservationFixture,
} from '../stock/reservation-fixture';
import { stockFixture, type StockFixture } from '../stock/stock-fixture';

afterAll(closeDb);

/**
 * H2 (docs/03-roadmap-appendix/phase3.md §7.1): confirming an order reserves free stock, the PIN
 * code's hub first, a kit's components, what is short backordered; cancelling releases it; the
 * Inventory Manager or the General Manager extends once, releases and moves; the platform fills
 * backorders in order of confirmation and lapses what ran out; a Lead Converter sees a line's
 * status and never a count.
 */

const E = 2;
const PIN = '302031';
let s: StockFixture;
let f: ReservationFixture;
let exec: Principal;
let manager: Principal;
let managerOther: Principal;
let lc: Principal;
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

/** Stock of an item into a storage bin of the company, as the Inventory Manager adjusts it. */
async function gain(binId: string, itemId: string, qty: string): Promise<void> {
  await asPrincipal(manager, ({ tx }) =>
    stockMove(tx, [{ reason: 'adjust_gain', entityId: E, itemId, toBinId: binId, qty }]),
  );
}

let itemSeq = 0;

/** A new untracked item of this run, so only this test's orders and stock touch it. */
async function freshItem(): Promise<string> {
  const id = newId();
  itemSeq += 1;
  await asMigrator(
    (m) => m`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
      values (${id}, ${`RX-${f.tag}-${String(itemSeq)}`}, ${`Reservation item ${f.tag} ${String(itemSeq)}`},
              'pump', '8413', 'nos', false, true)`,
  );
  return id;
}

async function confirm(orderId: string, who: Principal = lc): Promise<void> {
  const out = await run<{ outcome: string }>(who, confirmSalesOrder, { entityId: E, orderId });
  expect(out.outcome).toBe('confirmed');
}

/** The events an aggregate raised, read as the publisher. */
function eventsOf(aggregateId: string) {
  return asOutboxPublisher(
    (m) => m<{ type: string; payload_json: Record<string, unknown> }[]>`
      select type, payload_json from outbox_events where aggregate_id = ${aggregateId}
       order by created_at, id`,
  );
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [E]);
  managerOther = await createTestPrincipal('inventory_manager', [3]);
  lc = await createTestPrincipal('tele_caller_lc', [E]);
  gm = await createTestPrincipal('general_manager', [E]);
  s = await stockFixture(exec.id);
  f = await reservationFixture(E, lc.id, PIN);
  // The other hub serves the site's PIN code, so an order of that site takes its stock first.
  await asMigrator((m) => m`update warehouses set pin_codes = ${[PIN]} where id = ${s.otherHub}`);
});

describe('sales.order.confirm reserves', () => {
  it('free stock, the PIN code’s hub first, a kit by its components, the short backordered', async () => {
    await gain(s.otherBin, f.panel, '3');
    await gain(s.binA, f.panel, '10');
    await gain(s.binA, f.inverter, '1');
    // Stock outside a storage bin is never free.
    await gain(s.receiving, f.inverter, '5');
    const { orderId, lineIds } = await draftOrder(f, lc.id, [
      { itemId: f.panel, qty: '5' },
      { kitId: f.kit, qty: '2' },
      { itemId: f.service, qty: '1' },
    ]);
    await confirm(orderId);

    const held = await reservationsOf(orderId);
    const of = (lineId: string | undefined, itemId: string) =>
      held.filter((r) => r.lineId === lineId && r.itemId === itemId);
    // The panel line: 3 from the PIN code's hub, the rest from the other.
    expect(of(lineIds[0], f.panel).map((r) => [r.binId, r.qty])).toEqual([
      [s.otherBin, '3.000'],
      [s.binA, '2.000'],
    ]);
    // The kit line: 4 panels and the one inverter in storage; one inverter short.
    expect(of(lineIds[1], f.panel).map((r) => [r.binId, r.qty])).toEqual([[s.binA, '4.000']]);
    expect(of(lineIds[1], f.inverter).map((r) => [r.binId, r.qty])).toEqual([[s.binA, '1.000']]);
    expect(held.every((r) => r.state === 'active')).toBe(true);
    const hold = WORKSHOP_DEFAULTS.stock.reservationHoldDays * 86_400_000;
    for (const r of held) {
      expect(Math.abs(new Date(r.expiresAt).getTime() - Date.now() - hold)).toBeLessThan(600_000);
    }
    // One kit of two waits for an inverter; the service needs no stock.
    expect(await backordersOf(orderId)).toEqual(['0.000', '1.000', '0.000']);
    expect(await balanceOf(E, s.binA, f.panel)).toEqual({ onHand: '10.000', reserved: '6.000' });
    expect(await balanceOf(E, s.otherBin, f.panel)).toEqual({ onHand: '3.000', reserved: '3.000' });
    expect(await balanceOf(E, s.receiving, f.inverter)).toEqual({
      onHand: '5.000',
      reserved: '0.000',
    });
  });

  it('a second confirmation of the same order is refused, and its stock stays reserved once', async () => {
    const { orderId } = await draftOrder(f, lc.id, [{ itemId: f.panel, qty: '1' }]);
    await confirm(orderId);
    await expect(confirm(orderId)).rejects.toMatchObject({ code: 'conflict' });
    expect((await reservationsOf(orderId)).length).toBe(1);
  });
});

describe('availability on an order', () => {
  it('answers a Lead Converter the status and the date, in a shape with no count', async () => {
    await gain(s.binB, f.inverter, '0.5');
    const { orderId } = await draftOrder(f, lc.id, [
      { itemId: f.inverter, qty: '1' },
      { itemId: f.service, qty: '1' },
    ]);
    const read = (who: Principal): Promise<LineAvailabilityDto> =>
      asPrincipal(who, (ctx) =>
        readLineAvailability(ctx, { entityId: E, kind: 'order', id: orderId }),
      );
    // A draft reads the free stock: half of what the line needs is free in storage.
    const draft = await read(lc);
    expect(draft).toEqual({
      withCounts: false,
      lines: [
        {
          lineId: expect.any(String) as unknown,
          position: 1,
          status: 'partly_covered',
          expectedOn: null,
        },
      ],
    });
    for (const line of draft.lines) {
      expect(Object.keys(line).sort()).toEqual(['expectedOn', 'lineId', 'position', 'status']);
    }
    const counted = await read(manager);
    expect(counted.withCounts).toBe(true);
    expect(counted.lines[0]).toMatchObject({
      status: 'partly_covered',
      free: expect.any(String) as unknown,
    });

    await confirm(orderId);
    const confirmed = await read(lc);
    expect(confirmed.withCounts).toBe(false);
    expect(confirmed.lines.map((l) => l.status)).toEqual(['partly_covered']);
    expect(JSON.stringify(confirmed)).not.toMatch(/"(free|reserved|backordered)"/);
    const managerView = await read(manager);
    expect(managerView.lines[0]).toMatchObject({
      status: 'partly_covered',
      free: null,
      reserved: '0.500',
      backordered: '0.500',
      dispatched: '0.000',
    });
  });

  it('is refused to a caller who reads neither stock nor the lead’s quotes', async () => {
    const { orderId } = await draftOrder(f, lc.id, [{ itemId: f.panel, qty: '1' }]);
    const accounts = await createTestPrincipal('accounts', [E]);
    // A Field Engineer reads its own stock only, and makes no quote.
    const field = await createTestPrincipal('field_engineer', [E]);
    await expect(
      asPrincipal(field, (ctx) =>
        readLineAvailability(ctx, { entityId: E, kind: 'order', id: orderId }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Accounts reads stock in its company, and so the counts.
    const view: LineAvailabilityDto = await asPrincipal(accounts, (ctx) =>
      readLineAvailability(ctx, { entityId: E, kind: 'order', id: orderId }),
    );
    expect(view.withCounts).toBe(true);
  });
});

describe('the stock lists of reservations and backorders', () => {
  it('list an order’s and an item’s active holds, and its backorders in queue order, with inventory.stock.read', async () => {
    const item = await freshItem();
    await gain(s.binA, item, '1');
    const first = await draftOrder(f, lc.id, [{ itemId: item, qty: '2' }]);
    const second = await draftOrder(f, lc.id, [{ itemId: item, qty: '1' }]);
    await confirm(first.orderId);
    await confirm(second.orderId);
    const held = await asPrincipal(manager, (ctx) =>
      listReservations(ctx, { entityId: E, orderId: first.orderId }),
    );
    expect(held.items).toHaveLength(1);
    expect(held.items[0]).toMatchObject({
      orderId: first.orderId,
      itemId: item,
      qty: '1.000',
      hubId: s.hub,
      binCode: 'A1',
      extended: false,
      // The Inventory Manager reads no lead's order: its number and line stay hidden.
      soNo: null,
      linePosition: null,
    });
    const byItem = await asPrincipal(gm, (ctx) =>
      listReservations(ctx, { entityId: E, itemId: item }),
    );
    expect(byItem.items.map((r) => r.orderId)).toEqual([first.orderId]);
    expect(byItem.items[0]?.soNo).not.toBeNull();
    const waiting = await asPrincipal(manager, (ctx) =>
      listItemBackorders(ctx, { entityId: E, itemId: item }),
    );
    expect(waiting.items.map((b) => [b.orderId, b.backordered])).toEqual([
      [first.orderId, '1.000'],
      [second.orderId, '1.000'],
    ]);
    const reads: ((ctx: RequestContext) => Promise<unknown>)[] = [
      (ctx) => listReservations(ctx, { entityId: E, itemId: item }),
      (ctx) => listItemBackorders(ctx, { entityId: E, itemId: item }),
    ];
    for (const read of reads) {
      await expect(asPrincipal(lc, read)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(asPrincipal(managerOther, read)).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('preview the quote builder’s lines: a status for a Lead Converter, the free stock for the Inventory Manager', async () => {
    const item = await freshItem();
    await gain(s.binB, item, '2');
    const lines = [
      { position: 1, itemId: item, qty: '3' },
      { position: 2, kitId: f.kit, qty: '1' },
      { position: 3, itemId: f.service, qty: '1' },
    ];
    const status = await asPrincipal(lc, (ctx) =>
      previewLineAvailability(ctx, { entityId: E, lines }),
    );
    expect(status.withCounts).toBe(false);
    expect(status.lines.map((l) => [l.position, l.status])).toEqual([
      [1, 'partly_covered'],
      [2, expect.any(String) as unknown],
    ]);
    expect(JSON.stringify(status)).not.toMatch(/"(free|reserved|backordered|dispatched)"/);
    const counted = await asPrincipal(manager, (ctx) =>
      previewLineAvailability(ctx, { entityId: E, lines }),
    );
    expect(counted.withCounts).toBe(true);
    expect(counted.lines[0]).toMatchObject({ position: 1, free: '2.000', lineId: null });
    const field = await createTestPrincipal('field_engineer', [E]);
    await expect(
      asPrincipal(field, (ctx) => previewLineAvailability(ctx, { entityId: E, lines })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('sales.order.cancel releases', () => {
  it('every active reservation with the reason, and leaves nothing backordered', async () => {
    await gain(s.binB, f.panel, '2');
    const { orderId } = await draftOrder(f, lc.id, [{ kitId: f.kit, qty: '3' }]);
    await confirm(orderId);
    const before = await reservationsOf(orderId);
    expect(before.length).toBeGreaterThan(0);
    const reservedBefore = await balanceOf(E, s.binB, f.panel);
    await run(gm, cancelSalesOrder, { entityId: E, orderId, reason: 'Customer changed the plan' });
    const after = await reservationsOf(orderId);
    expect(after.every((r) => r.state === 'released' && r.releaseKind === 'order_cancelled')).toBe(
      true,
    );
    expect(await backordersOf(orderId)).toEqual(['0.000']);
    const panelHere = before
      .filter((r) => r.binId === s.binB && r.itemId === f.panel)
      .reduce((sum, r) => sum + Number(r.qty), 0);
    expect(Number((await balanceOf(E, s.binB, f.panel)).reserved)).toBe(
      Number(reservedBefore.reserved) - panelHere,
    );
  });
});

describe('app.stock_move() keeps what a bin holds for orders', () => {
  it('refuses a loss or a move that takes a bin below its reserved quantity, naming the item and bin', async () => {
    const item = await freshItem();
    await gain(s.binB, item, '2');
    const { orderId } = await draftOrder(f, lc.id, [{ itemId: item, qty: '1' }]);
    await confirm(orderId);
    expect(await balanceOf(E, s.binB, item)).toEqual({ onHand: '2.000', reserved: '1.000' });
    const loss = (qty: string) =>
      asPrincipal(manager, ({ tx }) =>
        stockMove(tx, [
          { reason: 'adjust_loss', entityId: E, itemId: item, fromBinId: s.binB, qty },
        ]),
      );
    await expect(loss('2')).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'stock_reserved_insufficient', itemId: item, binId: s.binB },
    });
    await expect(
      asPrincipal(manager, ({ tx }) =>
        stockMove(tx, [
          {
            reason: 'transfer',
            entityId: E,
            itemId: item,
            fromBinId: s.binB,
            toBinId: s.binA,
            qty: '2',
          },
        ]),
      ),
    ).rejects.toMatchObject({ details: { reason: 'stock_reserved_insufficient' } });
    // What is free still moves.
    await loss('1');
    expect(await balanceOf(E, s.binB, item)).toEqual({ onHand: '1.000', reserved: '1.000' });
  });
});

/** A confirmed order with one active reservation of a new item in bin A. */
async function heldOrder(): Promise<{ orderId: string; reservationId: string; item: string }> {
  const item = await freshItem();
  await gain(s.binA, item, '1');
  const { orderId } = await draftOrder(f, lc.id, [{ itemId: item, qty: '1' }]);
  await confirm(orderId);
  const [held] = (await reservationsOf(orderId)).filter((r) => r.state === 'active');
  if (!held) throw new Error('nothing was reserved');
  return { orderId, reservationId: held.id, item };
}

describe('inventory.reservation.extend', () => {
  it('is refused without its grant, to an agent, and in another company', async () => {
    const { reservationId } = await heldOrder();
    const input = { entityId: E, reservationId, authority: 'stock', reason: 'Customer asked' };
    await expect(run(lc, extendReservation, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(lc, extendReservation, { ...input, authority: 'order' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(gm, extendReservation, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(principalFor('agent:chief', [E]), extendReservation, input),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(managerOther, extendReservation, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(managerOther, extendReservation, { ...input, entityId: 3 }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'reservation_missing' } });
  });

  it('holds it one more period, once, by the Inventory Manager or the General Manager', async () => {
    const first = await heldOrder();
    const [before] = await reservationsOf(first.orderId);
    const out = await run<{ expiresAt: Date }>(manager, extendReservation, {
      entityId: E,
      reservationId: first.reservationId,
      authority: 'stock',
      reason: 'Site not ready',
    });
    const hold = WORKSHOP_DEFAULTS.stock.reservationHoldDays * 86_400_000;
    expect(new Date(out.expiresAt).getTime() - new Date(before?.expiresAt ?? 0).getTime()).toBe(
      hold,
    );
    await expect(
      run(manager, extendReservation, {
        entityId: E,
        reservationId: first.reservationId,
        authority: 'stock',
        reason: 'Again',
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'reservation_already_extended' },
    });
    const second = await heldOrder();
    await run(gm, extendReservation, {
      entityId: E,
      reservationId: second.reservationId,
      authority: 'order',
      reason: 'Payment on the way',
    });
    expect((await eventsOf(second.reservationId)).map((e) => e.type)).toEqual([
      'inventory.reservation.extended',
    ]);
  });
});

describe('inventory.reservation.release', () => {
  it('is refused without inventory.stock.adjust and in another company', async () => {
    const { reservationId } = await heldOrder();
    const input = { entityId: E, reservationId, reason: 'Needed elsewhere' };
    await expect(run(lc, releaseReservation, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(gm, releaseReservation, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(managerOther, releaseReservation, { ...input, entityId: 3 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('frees the stock by hand and puts the quantity back on order', async () => {
    const { orderId, reservationId, item } = await heldOrder();
    expect((await balanceOf(E, s.binA, item)).reserved).toBe('1.000');
    await run(manager, releaseReservation, {
      entityId: E,
      reservationId,
      reason: 'Needed for an older order',
    });
    const [after] = await reservationsOf(orderId);
    expect(after).toMatchObject({ state: 'released', releaseKind: 'by_hand' });
    expect((await balanceOf(E, s.binA, item)).reserved).toBe('0.000');
    expect(await backordersOf(orderId)).toEqual(['1.000']);
    const [event] = await eventsOf(reservationId);
    expect(event).toMatchObject({
      type: 'inventory.reservation.released',
      payload_json: { reservationId, salesOrderId: orderId, itemId: item },
    });
    await expect(
      run(manager, releaseReservation, { entityId: E, reservationId, reason: 'Twice' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('inventory.reservation.move', () => {
  it('is refused without inventory.stock.adjust and in another company', async () => {
    const { reservationId } = await heldOrder();
    const input = { entityId: E, reservationId, hubId: s.otherHub };
    await expect(run(lc, moveReservation, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(managerOther, moveReservation, { ...input, entityId: 3 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reserves the same quantity in another hub, whole or not at all', async () => {
    const { orderId, reservationId, item } = await heldOrder();
    const input = { entityId: E, reservationId, hubId: s.otherHub };
    // The other hub holds none of the item: refused, and nothing changes.
    await expect(run(manager, moveReservation, input)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'reservation_stock_short' },
    });
    await expect(run(manager, moveReservation, { ...input, hubId: s.hub })).rejects.toMatchObject({
      details: { reason: 'reservation_move_same_hub' },
    });
    expect((await balanceOf(E, s.binA, item)).reserved).toBe('1.000');
    await gain(s.otherBin, item, '1');
    const out = await run<{ reservationIds: string[] }>(manager, moveReservation, input);
    expect(out.reservationIds.length).toBe(1);
    const rows = await reservationsOf(orderId);
    expect(rows.find((r) => r.id === reservationId)).toMatchObject({
      state: 'released',
      releaseKind: 'moved',
    });
    expect(rows.find((r) => r.id === out.reservationIds[0])).toMatchObject({
      state: 'active',
      hubId: s.otherHub,
      qty: '1.000',
    });
    expect(await backordersOf(orderId)).toEqual(['0.000']);
    expect((await balanceOf(E, s.binA, item)).reserved).toBe('0.000');
    expect((await balanceOf(E, s.otherBin, item)).reserved).toBe('1.000');
  });
});

describe('the platform’s jobs', () => {
  it('are refused to every person, the Executive included', async () => {
    for (const who of [exec, manager, gm]) {
      await expect(
        run(who, fillBackorders, { entityId: E, itemIds: [f.panel] }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(run(who, scanReservations, { entityId: E })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('fill backorders in order of confirmation as stock arrives', async () => {
    // A fresh item, so only this test's orders wait for it.
    const pump = await freshItem();
    const first = await draftOrder(f, lc.id, [{ itemId: pump, qty: '2' }]);
    const second = await draftOrder(f, lc.id, [{ itemId: pump, qty: '2' }]);
    await confirm(first.orderId);
    await confirm(second.orderId);
    expect(await backordersOf(first.orderId)).toEqual(['2.000']);
    await gain(s.binA, pump, '3');
    const out = await run<{ filled: number }>(workers(), fillBackorders, {
      entityId: E,
      itemIds: [pump],
    });
    expect(out.filled).toBe(2);
    expect(await backordersOf(first.orderId)).toEqual(['0.000']);
    expect(await backordersOf(second.orderId)).toEqual(['1.000']);
    expect(await balanceOf(E, s.binA, pump)).toEqual({ onHand: '3.000', reserved: '3.000' });
    const [event] = await eventsOf(pump);
    expect(event).toMatchObject({
      type: 'inventory.reservation.filled',
      payload_json: { itemId: pump, count: 2 },
    });
    expect(JSON.stringify(event?.payload_json)).not.toMatch(/qty|quantity/i);

    // The first order's hold runs out: the scan lapses it, and the next backorder takes the stock.
    await asMigrator(
      (m) => m`update reservations set expires_at = now() - interval '1 minute'
                where sales_order_id = ${first.orderId} and state = 'active'`,
    );
    const scan = await run<{ lapsed: number }>(workers(), scanReservations, { entityId: E });
    expect(scan.lapsed).toBeGreaterThanOrEqual(1);
    expect(await backordersOf(first.orderId)).toEqual(['2.000']);
    await run(workers(), fillBackorders, { entityId: E, itemIds: [pump] });
    expect(await backordersOf(second.orderId)).toEqual(['0.000']);
    // The lapsed order waits behind it, and takes what is left.
    expect(await backordersOf(first.orderId)).toEqual(['1.000']);
    expect(await balanceOf(E, s.binA, pump)).toEqual({ onHand: '3.000', reserved: '3.000' });
    const lapsed = await eventsOf(first.orderId);
    expect(lapsed.map((e) => e.type)).toContain('inventory.reservation.lapsed');
  });

  it('remind the order’s owner once, the reminder days before it lapses', async () => {
    const { orderId, reservationId } = await heldOrder();
    const soon = WORKSHOP_DEFAULTS.stock.reservationReminderDays * 86_400_000 - 3_600_000;
    await asMigrator(
      (
        m,
      ) => m`update reservations set expires_at = now() + ${`${String(soon)} milliseconds`}::interval
                where id = ${reservationId}`,
    );
    const first = await run<{ reminded: number }>(workers(), scanReservations, { entityId: E });
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    const events = (await eventsOf(orderId)).filter(
      (e) => e.type === 'inventory.reservation.expiring',
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload_json).toMatchObject({ salesOrderId: orderId, ownerId: lc.id });
    await run(workers(), scanReservations, { entityId: E });
    expect(
      (await eventsOf(orderId)).filter((e) => e.type === 'inventory.reservation.expiring'),
    ).toHaveLength(1);
  });

  it('tell the order’s owner and the company’s Inventory Managers, once a reminder', async () => {
    const owner = await createTestUser([{ entityId: E, roleKey: 'tele_caller_lc' }]);
    const keeper = await createTestUser([{ entityId: E, roleKey: 'inventory_manager' }]);
    const elsewhere = await createTestUser([{ entityId: 3, roleKey: 'inventory_manager' }]);
    const { orderId } = await heldOrder();
    const input = {
      event: 'inventory.reservation.expiring',
      entityId: E,
      eventId: newId(),
      orderId,
      ownerId: owner.id,
    };
    await run(workers(), notifyEvent, input);
    await run(workers(), notifyEvent, input);
    const notices = await asMigrator(
      (m) => m<{ user_id: string; type: string }[]>`
        select user_id, type from notifications where subject_id = ${orderId}`,
    );
    const to = notices.map((n) => n.user_id);
    expect(to.filter((u) => u === owner.id)).toHaveLength(1);
    expect(to.filter((u) => u === keeper.id)).toHaveLength(1);
    expect(to).not.toContain(elsewhere.id);
    expect(new Set(notices.map((n) => n.type))).toEqual(new Set(['reservation_expiring']));
    await expect(run(manager, notifyEvent, input)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('send a cancelled order’s freed holds to the fill', async () => {
    const { orderId, reservationId, item } = await heldOrder();
    await run(gm, cancelSalesOrder, { entityId: E, orderId, reason: 'Customer withdrew' });
    const events = await eventsOf(reservationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'inventory.reservation.released',
      payload_json: { reservationId, salesOrderId: orderId, itemId: item },
    });
  });

  it('refuse a company outside the request', async () => {
    await expect(run(workers(), scanReservations, { entityId: 3 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(workers(), fillBackorders, { entityId: 3, itemIds: [f.panel] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
