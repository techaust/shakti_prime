import {
  DomainError,
  ItemUnitSchema,
  ListPricesInput,
  PriceListDto,
  PriceRowDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { istCalendarDate } from '../../numbering/financial-year';
import { parseQueryInput } from '../parse-input';

type PricingContext = Pick<RequestContext, 'tx' | 'principal'>;

/**
 * Price Master: the price lists the caller can read (`pricing.read`), shared ones and those of
 * the request's companies, newest version first within each tier. A list that has ended or been
 * archived is marked closed, as `pricing.price.set` treats it (AUDIT M19).
 */
export async function listPriceLists(
  ctx: PricingContext,
  now: Date = new Date(),
): Promise<PriceListDto[]> {
  checkPermission(ctx.principal, 'pricing.read', 'entity');
  const pl = schema.priceLists;
  const t = schema.priceTiers;
  const today = istCalendarDate(now);
  const rows = await ctx.tx
    .select({
      id: pl.id,
      tierCode: t.code,
      tierName: t.name,
      entityId: pl.entityId,
      version: pl.version,
      effectiveFrom: pl.effectiveFrom,
      effectiveTo: pl.effectiveTo,
      archivedAt: pl.archivedAt,
    })
    .from(pl)
    .innerJoin(t, eq(t.id, pl.tierId))
    .orderBy(asc(t.code), asc(pl.entityId), desc(pl.version), asc(pl.id));
  return rows.map((r) =>
    PriceListDto.parse({
      id: r.id,
      tierCode: r.tierCode,
      tierName: r.tierName,
      entityId: r.entityId,
      version: r.version,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      open: r.archivedAt === null && (r.effectiveTo === null || r.effectiveTo > today),
    }),
  );
}

/**
 * The active items with their price on one list, by name. Items not yet priced on the list come
 * back with a null price, so Price Master can set their first price. Never joins `item_costs`:
 * selling prices only (docs/SECURITY.md §4). The list itself must be readable to the caller.
 */
export async function listPrices(ctx: PricingContext, rawInput: unknown): Promise<PriceRowDto[]> {
  const input = parseQueryInput(ListPricesInput, rawInput, 'pricing.prices.list');
  checkPermission(ctx.principal, 'pricing.read', 'entity');
  const pl = schema.priceLists;
  const [list] = await ctx.tx
    .select({ id: pl.id })
    .from(pl)
    .where(eq(pl.id, input.priceListId))
    .limit(1);
  if (!list) {
    throw new DomainError('not_found', `price list ${input.priceListId} is not visible`, {
      reason: 'price_list_missing',
    });
  }
  const i = schema.items;
  const pli = schema.priceListItems;
  const rows = await ctx.tx
    .select({
      itemId: i.id,
      sku: i.sku,
      name: i.name,
      category: i.category,
      unit: i.unit,
      price: pli.price,
      updatedAt: pli.updatedAt,
    })
    .from(i)
    .leftJoin(pli, and(eq(pli.itemId, i.id), eq(pli.priceListId, input.priceListId)))
    .where(and(isNull(i.archivedAt), eq(i.isActive, true)))
    .orderBy(asc(i.name), asc(i.id));
  return rows.map((r) =>
    PriceRowDto.parse({
      itemId: r.itemId,
      sku: r.sku,
      name: r.name,
      category: r.category,
      unit: ItemUnitSchema.parse(r.unit),
      price: r.price,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    }),
  );
}
