import {
  DomainError,
  ListSalesOrdersInput,
  OrderSearchHitDto,
  SalesOrderPageDto,
  SalesOrderRefInput,
  SearchInput,
  type SalesOrderDto,
  type SalesOrderRowDto,
  type SalesOrderState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
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
import { containsPattern } from '../search-text';
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
 * company or every company of the request, optionally of one state and of a number holding `q`
 * (RPT-03, candidates from `orderNumberMatches`). Keyset paging on
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
    searchCapped: input.q === undefined ? false : await searchReachedCap(ctx, input.q, input.state),
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
    q?: string | undefined;
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
        input.q === undefined ? undefined : orderNumberMatches(input.q, input.state),
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

/** The most candidates a number search takes, the newest first (`app.order_search_ids()`). */
const SEARCH_CAP = 200;

/**
 * The orders whose number holds `text` (RPT-03). Under the policies `ilike` is never an index
 * condition, so the candidates come first from the definer `app.order_search_ids()`, which finds at
 * most 200 on the trigram index of `so_no` among the orders the caller reads, of one state when the
 * list asks for one (before the limit); the query reads only those, under the policies, and the
 * text is applied again here.
 */
function orderNumberMatches(text: string, state?: SalesOrderState) {
  const so = schema.salesOrders;
  return and(
    inArray(so.id, sql`(select app.order_search_ids(${text}, ${state ?? null}, ${SEARCH_CAP}))`),
    ilike(so.soNo, containsPattern(text)),
  );
}

/**
 * Whether the number search found as many candidates as it takes, so older matches may have been
 * left out: `/orders` then says so (`searchCapped`).
 */
async function searchReachedCap(
  ctx: OrderListContext,
  text: string,
  state: SalesOrderState | undefined,
): Promise<boolean> {
  const rows = (await ctx.tx.execute(
    sql`select count(*)::int as n from app.order_search_ids(${text}, ${state ?? null}, ${SEARCH_CAP})`,
  )) as unknown as { n: number }[];
  return (rows[0]?.n ?? 0) >= SEARCH_CAP;
}

/**
 * The ⌘K search for orders by number (RPT-03): the orders the caller can read whose number holds
 * the typed text, a number that is the text first, then the newest. Bounded by `limit`.
 */
export async function searchSalesOrders(
  ctx: OrderListContext,
  rawInput: unknown,
): Promise<OrderSearchHitDto[]> {
  const input = parseQueryInput(SearchInput, rawInput, 'sales.order.search');
  const rows = await orderSearchQuery(ctx, input);
  return rows.map((row) => OrderSearchHitDto.parse(row));
}

/** The query `searchSalesOrders` runs, unexecuted, so the plan can be read. Checks the permission. */
export function orderSearchQuery(ctx: OrderListContext, input: { q: string; limit: number }) {
  checkOrderRead(ctx);
  const so = schema.salesOrders;
  const a = schema.accounts;
  return ctx.tx
    .select({
      id: so.id,
      entityId: so.entityId,
      soNo: so.soNo,
      customerName: a.name,
      state: so.state,
    })
    .from(so)
    .innerJoin(a, eq(a.id, so.accountId))
    .where(and(orderNumberMatches(input.q), inArray(so.entityId, [...ctx.entityIds])))
    .orderBy(sql`lower(${so.soNo}) = lower(${input.q}) desc`, desc(so.createdAt), desc(so.id))
    .limit(input.limit);
}
