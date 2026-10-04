import {
  DomainError,
  ItemUnitSchema,
  ListPricesInput,
  type PriceListDto,
  PricePageDto,
  PriceRowDto,
  type PriceSort,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { istCalendarDate } from '../../numbering/financial-year';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { parseQueryInput } from '../parse-input';
import { toPriceListDto } from './list-state';

type PricingContext = Pick<RequestContext, 'tx' | 'principal'>;

/**
 * The columns Price Master sorts by (`PRICE_SORT_COLUMNS`), over the active catalogue, a few
 * thousand items at most. The price and its date are empty for an item not yet priced on the
 * list, and those come last either way. The unit is left out: its shown name comes from the
 * message catalogue, so the stored key would order it differently.
 */
const PRICE_SORT_KEYS: SortKeys<PriceSort['column']> = {
  item: { expr: schema.items.name, type: 'text', nullable: false },
  code: { expr: schema.items.sku, type: 'text', nullable: false },
  category: { expr: schema.items.category, type: 'text', nullable: false },
  price: { expr: schema.priceListItems.price, type: 'numeric', nullable: true },
  updated: { expr: schema.priceListItems.updatedAt, type: 'timestamptz', nullable: true },
};

/**
 * Price Master: the price lists the caller can read (`pricing.read`), shared ones and those of
 * the request's companies, newest version first within each tier, each with its state (draft,
 * scheduled, live or ended). A list that has ended or been archived is marked closed, as
 * `pricing.price.set` treats it (AUDIT M19).
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
      approvedAt: pl.approvedAt,
      archivedAt: pl.archivedAt,
    })
    .from(pl)
    .innerJoin(t, eq(t.id, pl.tierId))
    .orderBy(asc(t.code), asc(pl.entityId), desc(pl.version), asc(pl.id));
  return rows.map((r) => toPriceListDto(r, today));
}

/**
 * The active items with their price on one list, by name unless `sort` asks for another column,
 * a page at a time (keyset on the sort value and id, docs/API.md §1). Items not yet priced on the
 * list come back with a null price, so Price Master can set their first price. Never joins
 * `item_costs`: selling prices only (docs/SECURITY.md §4). The list itself must be readable to
 * the caller.
 */
export async function listPrices(ctx: PricingContext, rawInput: unknown): Promise<PricePageDto> {
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
  const order = keysetOrder(PRICE_SORT_KEYS, i.id, input.sort, {
    column: 'item',
    direction: 'asc',
  });
  const rows = await ctx.tx
    .select({
      itemId: i.id,
      sku: i.sku,
      name: i.name,
      category: i.category,
      unit: i.unit,
      price: pli.price,
      updatedAt: pli.updatedAt,
      sortValue: sortText(order),
    })
    .from(i)
    .leftJoin(pli, and(eq(pli.itemId, i.id), eq(pli.priceListId, input.priceListId)))
    .where(and(isNull(i.archivedAt), eq(i.isActive, true), afterCursor(order, input.cursor)))
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return PricePageDto.parse({
    items: page.map((r) =>
      PriceRowDto.parse({
        itemId: r.itemId,
        sku: r.sku,
        name: r.name,
        category: r.category,
        unit: ItemUnitSchema.parse(r.unit),
        price: r.price,
        updatedAt: r.updatedAt?.toISOString() ?? null,
      }),
    ),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.itemId },
    ),
  });
}
