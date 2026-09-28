import { DomainError, type ItemDto, type ItemWithCostDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { toItemDto, toItemWithCostDto } from './item-dto';

/** One page of the catalogue and where the next starts, or null after the last page. */
export interface ItemPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListItemsOptions {
  cursor?: string | undefined;
  /** Items per page: 50 unless asked, never more than 200, as the other lists. */
  limit?: number | undefined;
}

/**
 * The catalogue reads by name, then id, so items that share a name keep one place; the cursor
 * takes the text form of `keyset-sort.ts`.
 */
const ITEM_SORT_KEYS: SortKeys<'name'> = {
  name: { expr: schema.items.name, type: 'text', nullable: false },
};
const itemOrder = () =>
  keysetOrder(ITEM_SORT_KEYS, schema.items.id, undefined, { column: 'name', direction: 'asc' });

const pageSize = (limit: number | undefined) => Math.min(Math.max(limit ?? 50, 1), 200);

/**
 * The catalogue as every reader sees it, a page at a time by name: never joins `item_costs`.
 * Items are shared by every company (docs/DATABASE.md), so RLS gives every reader the same rows.
 */
export async function listItems(
  ctx: Pick<RequestContext, 'tx'>,
  options: ListItemsOptions = {},
): Promise<ItemPage<ItemDto>> {
  const limit = pageSize(options.limit);
  const order = itemOrder();
  const rows = await ctx.tx
    .select({ item: schema.items, sortValue: sortText(order) })
    .from(schema.items)
    .where(and(isNull(schema.items.archivedAt), afterCursor(order, options.cursor)))
    .orderBy(...orderTerms(order))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toItemDto(r.item)),
    nextCursor: nextCursor(
      order,
      rows.length > limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.item.id },
    ),
  };
}

/**
 * The catalogue with one entity's cost side (docs/SECURITY.md §4), a page at a time by name.
 * Guarded twice: the permission check here and the cost-gate policy on `item_costs`, so a caller
 * without `finance.cost.read` is refused before the query and would see null costs even if it
 * were not.
 */
export async function listItemsWithCost(
  ctx: RequestContext,
  entityId: number,
  options: ListItemsOptions = {},
): Promise<ItemPage<ItemWithCostDto>> {
  checkPermission(ctx.principal, 'finance.cost.read', 'entity');
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const limit = pageSize(options.limit);
  const order = itemOrder();
  const rows = await ctx.tx
    .select({ item: schema.items, cost: schema.itemCosts, sortValue: sortText(order) })
    .from(schema.items)
    .leftJoin(
      schema.itemCosts,
      and(eq(schema.itemCosts.itemId, schema.items.id), eq(schema.itemCosts.entityId, entityId)),
    )
    .where(and(isNull(schema.items.archivedAt), afterCursor(order, options.cursor)))
    .orderBy(...orderTerms(order))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toItemWithCostDto(r.item, r.cost)),
    nextCursor: nextCursor(
      order,
      rows.length > limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.item.id },
    ),
  };
}
