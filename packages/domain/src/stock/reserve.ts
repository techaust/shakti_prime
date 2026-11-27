import type { RequestTx } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { stockRefusal } from './move';

const DAY_MS = 86_400_000;

/** When a reservation made now lapses: the hold of `WORKSHOP_DEFAULTS.stock` (STOCK-4). */
export function holdUntil(now: Date): Date {
  return new Date(now.getTime() + WORKSHOP_DEFAULTS.stock.reservationHoldDays * DAY_MS);
}

/** The latest lapse the daily scan reminds of now: the reminder days ahead (STOCK-4). */
export function remindBefore(now: Date): Date {
  return new Date(now.getTime() + WORKSHOP_DEFAULTS.stock.reservationReminderDays * DAY_MS);
}

/**
 * Runs one of the reservation definers in the caller's transaction, a refusal thrown as a
 * `DomainError` with its catalogue reason (`stockRefusal()`).
 */
export async function reservationCall<T>(tx: RequestTx, query: SQL): Promise<T[]> {
  try {
    return (await tx.execute(query)) as unknown as T[];
  } catch (e) {
    throw stockRefusal(e) ?? e;
  }
}

/** One need of an order line, as confirmation left it. Quantities only reach the caller's code. */
export interface OrderNeed {
  needId: string;
  salesOrderLineId: string;
  itemId: string;
  qtyReserved: string;
  qtyBackordered: string;
}

/**
 * Confirmation's reservations (`app.reserve_order()`): the order's needs written and reserved from
 * the hubs in its preferred order, what is short backordered. Answers the needs; the caller keeps
 * their quantities out of anything a holder of only `sales.quote.create` reads.
 */
export function reserveOrder(tx: RequestTx, orderId: string, now: Date): Promise<OrderNeed[]> {
  return reservationCall<OrderNeed>(
    tx,
    sql`select need_id as "needId", sales_order_line_id as "salesOrderLineId", item_id as "itemId",
               qty_reserved::numeric(12, 3)::text as "qtyReserved",
               qty_backordered::numeric(12, 3)::text as "qtyBackordered"
          from app.reserve_order(${orderId}::uuid, ${holdUntil(now).toISOString()}::timestamptz)`,
  );
}

/** A reservation a cancellation released, with its item. */
export interface ReleasedReservation {
  reservationId: string;
  itemId: string;
}

/**
 * A cancelled order's reservations released with its reason, and nothing of it left backordered
 * (`app.release_order_reservations()`). Answers each reservation released, with its item.
 */
export function releaseOrderReservations(
  tx: RequestTx,
  orderId: string,
  reason: string,
): Promise<ReleasedReservation[]> {
  return reservationCall<ReleasedReservation>(
    tx,
    sql`select reservation_id as "reservationId", item_id as "itemId"
          from app.release_order_reservations(${orderId}::uuid, ${reason})`,
  );
}
