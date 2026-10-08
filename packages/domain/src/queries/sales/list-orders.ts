import {
  DomainError,
  ListSalesOrdersInput,
  SalesOrderPageDto,
  SalesOrderRefInput,
  type SalesOrderDto,
  type SalesOrderRowDto,
  type SalesOrderState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import {
  keysetOrder,
  afterCursor,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { parseQueryInput } from '../parse-input';
import { readSalesOrder, SALES_ORDER_ROW_COLUMNS, toSalesOrderRow } from './order-dto';

type OrderListContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** `/orders` reads newest first by `(created_at, id)`, so its cursor takes the keyset text form. */
const ORDER_SORT_KEYS: SortKeys<'created'> = {
  created: { expr: schema.salesOrders.createdAt, type: 'timestamptz', nullable: false },
};
const orderOrder = () =>
  keysetOrder(ORDER_SORT_KEYS, schema.salesOrders.id, undefined, {
    column: 'created',
    direction: 'desc',
  });

function companies(ctx: OrderListContext, entityId: number | undefined): number[] {
  if (entityId !== undefined && !ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  return entityId === undefined ? [...ctx.entityIds] : [entityId];
}

/**
 * Who opens the order screens: a person who reads leads (an order of a quote is read with its
 * lead) or customers (a dealer's order is read with the dealer). RLS decides which rows.
 */
function checkOrderRead(ctx: OrderListContext): void {
  try {
    checkPermission(ctx.principal, 'crm.lead.read', 'own');
  } catch {
    checkPermission(ctx.principal, 'crm.account.read', 'own');
  }
}

/**
 * `/orders` (docs/03-roadmap-appendix/phase1.md §8.3): the orders the caller can read, newest first, of one
 * company or every company of the request, optionally of one state. Keyset paging on
 * `sales_orders_entity_created_idx` (one company) or `sales_orders_created_idx` (several), read
 * backwards; the customer's name from the customer row, readable through the lead or the
 * relationship.
 */
export async function listSalesOrders(
  ctx: OrderListContext,
  rawInput: unknown,
): Promise<SalesOrderPageDto> {
  const input = parseQueryInput(ListSalesOrdersInput, rawInput, 'sales.order.list');
  const order = orderOrder();
  const rows = await salesOrderListQuery(ctx, input);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return SalesOrderPageDto.parse({
    items: page.map(toSalesOrderRow),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.id },
    ),
  });
}

/**
 * The query `listSalesOrders` runs, unexecuted, so the plan can be read
 * (`tests/spike/orders-explain.ts`). Checks the permission and the companies first.
 */
export function salesOrderListQuery(
  ctx: OrderListContext,
  input: {
    entityId?: number | undefined;
    state?: SalesOrderState | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  checkOrderRead(ctx);
  const so = schema.salesOrders;
  const a = schema.accounts;
  const order = orderOrder();
  return ctx.tx
    .select({ ...SALES_ORDER_ROW_COLUMNS, sortValue: sortText(order) })
    .from(so)
    .innerJoin(a, eq(a.id, so.accountId))
    .where(
      and(
        inArray(so.entityId, companies(ctx, input.entityId)),
        input.state === undefined ? undefined : eq(so.state, input.state),
        afterCursor(order, input.cursor),
      ),
    )
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
}

/** Account 360's orders: the customer's newest orders in one company (`sales_orders_account_idx`). */
export async function accountSalesOrders(
  ctx: OrderListContext,
  accountId: string,
  entityId: number,
  limit = 20,
): Promise<SalesOrderRowDto[]> {
  const so = schema.salesOrders;
  const a = schema.accounts;
  const rows = await ctx.tx
    .select(SALES_ORDER_ROW_COLUMNS)
    .from(so)
    .innerJoin(a, eq(a.id, so.accountId))
    .where(and(eq(so.accountId, accountId), eq(so.entityId, entityId)))
    .orderBy(desc(so.createdAt), desc(so.id))
    .limit(limit);
  return rows.map(toSalesOrderRow);
}

/** One order with its lines, for the order page. */
export async function getSalesOrder(
  ctx: OrderListContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<SalesOrderDto> {
  const input = parseQueryInput(SalesOrderRefInput, rawInput, 'sales.order.get');
  checkOrderRead(ctx);
  return readSalesOrder({ ...ctx, now }, input.entityId, input.orderId);
}
