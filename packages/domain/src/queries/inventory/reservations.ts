import {
  BackorderListDto,
  DomainError,
  ListItemBackordersInput,
  ListReservationsInput,
  ReservationListDto,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

/** At most this many rows a list shows; `more` says there are others. */
export const RESERVATION_LIST_LIMIT = 100;

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function requireCompany(ctx: Ctx, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

interface ReservationRow {
  id: string;
  entityId: number;
  orderId: string;
  soNo: string | null;
  linePosition: number | null;
  itemId: string;
  sku: string;
  itemName: string;
  hubId: string;
  hubCode: string;
  hubName: string;
  binCode: string;
  qty: string;
  expiresAt: Date | string;
  extended: boolean;
}

/**
 * The active reservations of one order, or of one item in a company (H2, the order page and the
 * stock card), soonest to lapse first, as row security shows them (`inventory.stock.read` for the
 * company). The order's number and line come only when the reader may read the order.
 */
export async function listReservations(ctx: Ctx, rawInput: unknown): Promise<ReservationListDto> {
  const input = parseQueryInput(ListReservationsInput, rawInput, 'inventory.reservation.list');
  checkPermission(ctx.principal, 'inventory.stock.read', 'entity');
  requireCompany(ctx, input.entityId);
  const byOrder =
    input.orderId === undefined ? sql`true` : sql`r.sales_order_id = ${input.orderId}`;
  const byItem = input.itemId === undefined ? sql`true` : sql`r.item_id = ${input.itemId}`;
  const rows = (await ctx.tx.execute(sql`
    select r.id, r.entity_id as "entityId", r.sales_order_id as "orderId", so.so_no as "soNo",
           l.position as "linePosition", r.item_id as "itemId", i.sku, i.name as "itemName",
           r.warehouse_id as "hubId", w.code as "hubCode", w.name as "hubName", b.code as "binCode",
           r.qty::numeric(12, 3)::text as qty, r.expires_at as "expiresAt",
           r.extended_at is not null as extended
      from reservations r
      join items i on i.id = r.item_id
      join warehouses w on w.id = r.warehouse_id
      join bins b on b.id = r.bin_id
      left join sales_orders so on so.id = r.sales_order_id
      left join sales_order_lines l on l.id = r.sales_order_line_id
     where r.entity_id = ${input.entityId} and r.state = 'active' and ${byOrder} and ${byItem}
     order by r.expires_at, r.id
     limit ${RESERVATION_LIST_LIMIT + 1}`)) as unknown as ReservationRow[];
  return ReservationListDto.parse({
    items: rows.slice(0, RESERVATION_LIST_LIMIT).map((r) => ({
      ...r,
      expiresAt: new Date(r.expiresAt).toISOString(),
    })),
    more: rows.length > RESERVATION_LIST_LIMIT,
  });
}

interface BackorderRow {
  orderId: string;
  soNo: string | null;
  linePosition: number | null;
  needed: string;
  backordered: string;
  queuedAt: Date | string;
}

/**
 * The backorders of an item in a company (H2, the stock card), in the order its free stock goes to
 * them, first in the queue first, as row security shows them (`inventory.stock.read` for the
 * company). Only an open order waits: a cancellation clears its backorders.
 */
export async function listItemBackorders(ctx: Ctx, rawInput: unknown): Promise<BackorderListDto> {
  const input = parseQueryInput(ListItemBackordersInput, rawInput, 'inventory.backorder.list');
  checkPermission(ctx.principal, 'inventory.stock.read', 'entity');
  requireCompany(ctx, input.entityId);
  const rows = (await ctx.tx.execute(sql`
    select n.sales_order_id as "orderId", so.so_no as "soNo", l.position as "linePosition",
           n.qty_needed::numeric(12, 3)::text as needed,
           n.qty_backordered::numeric(12, 3)::text as backordered, n.queued_at as "queuedAt"
      from reservation_needs n
      left join sales_orders so on so.id = n.sales_order_id
      left join sales_order_lines l on l.id = n.sales_order_line_id
     where n.entity_id = ${input.entityId} and n.item_id = ${input.itemId}
       and n.qty_backordered > 0
     order by n.queued_at, n.id
     limit ${RESERVATION_LIST_LIMIT + 1}`)) as unknown as BackorderRow[];
  return BackorderListDto.parse({
    items: rows.slice(0, RESERVATION_LIST_LIMIT).map((r) => ({
      ...r,
      queuedAt: new Date(r.queuedAt).toISOString(),
    })),
    more: rows.length > RESERVATION_LIST_LIMIT,
  });
}
