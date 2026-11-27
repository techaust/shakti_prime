import {
  FillBackordersDto,
  FillBackordersInput,
  newId,
  ReservationScanDto,
  ReservationScanInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import { reservationMachine } from '../../state-machines/machines/reservation';
import { holdUntil, remindBefore, reservationCall } from '../../stock/reserve';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * The platform's reservation jobs (H2, docs/03-roadmap-appendix/phase3.md §7.1), run as
 * `system:workers`, which holds the platform-only `inventory.reservations.process` and no person's
 * `inventory.*` or `sales.*` grant (ADR 0020): it reads and writes reservations only through the
 * definers that check that permission. Each run is one transaction per company; the fill runs on
 * its own, after the event that freed or brought the stock, so each takes its locks in the one
 * order.
 */

/** How many backorders of an item one fill serves, and how many reservations one scan takes. */
export const RESERVATION_BATCH = 500;

const SYSTEM = (job: string) => ({ kind: 'system' as const, job });

interface FilledRow {
  needId: string;
  salesOrderId: string;
}

/**
 * `inventory.reservation.fill`: the free stock of each item goes to its backorders in the company,
 * oldest in the queue first (`app.fill_backorders()`), each from its order's hubs in their
 * preferred order. Run on `inventory.stock.moved` when stock enters a storage bin, and when a
 * reservation lapses, is released or moves. One audit row per item that filled a backorder.
 */
export const fillBackorders = defineCommand({
  name: 'inventory.reservation.fill',
  permission: 'inventory.reservations.process',
  minScope: 'all',
  input: FillBackordersInput,
  output: FillBackordersDto,
  auditFields: ['filled'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    let filled = 0;
    for (const itemId of [...new Set(input.itemIds)].sort()) {
      const rows = await reservationCall<FilledRow>(
        ctx.tx,
        sql`select need_id as "needId", sales_order_id as "salesOrderId"
              from app.fill_backorders(${input.entityId}::smallint, ${itemId}::uuid,
                                       ${holdUntil(ctx.now).toISOString()}::timestamptz,
                                       ${RESERVATION_BATCH}::integer)`,
      );
      if (rows.length === 0) continue;
      transition(reservationMachine, { state: null, extendedAt: null }, 'fill', {
        actor: SYSTEM('reservation-fill'),
        now: ctx.now,
        params: {},
      });
      filled += rows.length;
      const orders = [...new Set(rows.map((r) => r.salesOrderId))];
      ctx.audit({
        aggregateType: 'item',
        aggregateId: itemId,
        entityId: input.entityId,
        before: null,
        after: { filled: rows.length },
      });
      ctx.emit({
        type: 'inventory.reservation.filled',
        entityId: input.entityId,
        aggregateType: 'item',
        aggregateId: itemId,
        payload: { itemId, count: orders.length, salesOrderIds: orders.slice(0, 200) },
      });
    }
    return { entityId: input.entityId, filled };
  },
});

interface LapsedRow {
  reservationId: string;
  salesOrderId: string;
  itemId: string;
}

interface ReminderRow {
  reservationId: string;
  salesOrderId: string;
  ownerId: string;
  expiresAt: Date | string;
}

/** Rows grouped by their order, in the order first met. */
function byOrder<T extends { salesOrderId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(row.salesOrderId, [...(out.get(row.salesOrderId) ?? []), row]);
  return out;
}

/**
 * `inventory.reservation.scan`: the daily scan of one company. Reservations past `expires_at`
 * lapse (`app.lapse_reservations()`): their stock is free, the quantity is back on order, and
 * `inventory.reservation.lapsed` sends the items to the fill. Those lapsing within the reminder
 * days (`WORKSHOP_DEFAULTS.stock`) are marked reminded (`app.reservation_reminders()`) and
 * `inventory.reservation.expiring` tells the order's owner and the Inventory Manager. One audit
 * row per run that changed anything; `more` when a batch was full.
 */
export const scanReservations = defineCommand({
  name: 'inventory.reservation.scan',
  permission: 'inventory.reservations.process',
  minScope: 'all',
  input: ReservationScanInput,
  output: ReservationScanDto,
  auditFields: ['lapsed', 'reminded'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const lapsed = await reservationCall<LapsedRow>(
      ctx.tx,
      sql`select reservation_id as "reservationId", sales_order_id as "salesOrderId",
                 item_id as "itemId"
            from app.lapse_reservations(${input.entityId}::smallint, ${RESERVATION_BATCH}::integer)`,
    );
    if (lapsed.length > 0) {
      transition(reservationMachine, { state: 'active', extendedAt: null }, 'lapse', {
        actor: SYSTEM('reservation-scan'),
        now: ctx.now,
        params: {},
      });
    }
    for (const [salesOrderId, rows] of byOrder(lapsed)) {
      ctx.emit({
        type: 'inventory.reservation.lapsed',
        entityId: input.entityId,
        aggregateType: 'sales_order',
        aggregateId: salesOrderId,
        payload: {
          salesOrderId,
          reservationIds: rows.map((r) => r.reservationId).slice(0, 200),
          itemIds: [...new Set(rows.map((r) => r.itemId))].slice(0, 200),
        },
      });
    }
    const reminders = await reservationCall<ReminderRow>(
      ctx.tx,
      sql`select reservation_id as "reservationId", sales_order_id as "salesOrderId",
                 owner_id as "ownerId", expires_at as "expiresAt"
            from app.reservation_reminders(${input.entityId}::smallint,
                                           ${remindBefore(ctx.now).toISOString()}::timestamptz,
                                           ${RESERVATION_BATCH}::integer)`,
    );
    for (const [salesOrderId, rows] of byOrder(reminders)) {
      const first = rows
        .map((r) => new Date(r.expiresAt))
        .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
      ctx.emit({
        type: 'inventory.reservation.expiring',
        entityId: input.entityId,
        aggregateType: 'sales_order',
        aggregateId: salesOrderId,
        payload: {
          salesOrderId,
          ownerId: rows[0]?.ownerId ?? '',
          expiresAt: first.toISOString(),
          reservationIds: rows.map((r) => r.reservationId).slice(0, 200),
        },
      });
    }
    // The items open orders wait for, so the run's catch-up fill reaches a backorder an event
    // missed (a batch of more than 200 movements, a delivery that failed for good).
    const backordered = await reservationCall<{ itemId: string }>(
      ctx.tx,
      sql`select item_id as "itemId"
            from app.backordered_items(${input.entityId}::smallint, ${RESERVATION_BATCH}::integer) as item_id`,
    );
    if (lapsed.length > 0 || reminders.length > 0) {
      ctx.audit({
        aggregateType: 'reservation_scan',
        aggregateId: newId(),
        entityId: input.entityId,
        before: null,
        after: { lapsed: lapsed.length, reminded: reminders.length },
      });
    }
    return {
      entityId: input.entityId,
      lapsed: lapsed.length,
      reminded: reminders.length,
      backorderedItemIds: backordered.map((r) => r.itemId),
      more: lapsed.length === RESERVATION_BATCH || reminders.length === RESERVATION_BATCH,
    };
  },
});
