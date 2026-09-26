import { DomainError, type ItemDto, type ItemWithCostDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { toItemDto, toItemWithCostDto } from './item-dto';

/** The catalogue as every reader sees it: never joins `item_costs`. */
export async function listItems(ctx: Pick<RequestContext, 'tx'>): Promise<ItemDto[]> {
  const rows = await ctx.tx
    .select()
    .from(schema.items)
    .where(isNull(schema.items.archivedAt))
    .orderBy(asc(schema.items.name), asc(schema.items.id));
  return rows.map(toItemDto);
}

/**
 * The catalogue with one entity's cost side (docs/SECURITY.md §4). Guarded twice: the permission
 * check here and the cost-gate policy on `item_costs`, so a caller without `finance.cost.read`
 * is refused before the query and would see null costs even if it were not.
 */
export async function listItemsWithCost(
  ctx: RequestContext,
  entityId: number,
): Promise<ItemWithCostDto[]> {
  checkPermission(ctx.principal, 'finance.cost.read', 'entity');
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const rows = await ctx.tx
    .select({ item: schema.items, cost: schema.itemCosts })
    .from(schema.items)
    .leftJoin(
      schema.itemCosts,
      and(eq(schema.itemCosts.itemId, schema.items.id), eq(schema.itemCosts.entityId, entityId)),
    )
    .where(isNull(schema.items.archivedAt))
    .orderBy(asc(schema.items.name), asc(schema.items.id));
  return rows.map((r) => toItemWithCostDto(r.item, r.cost));
}
