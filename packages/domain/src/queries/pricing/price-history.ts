import {
  DomainError,
  KitPricePageDto,
  ListKitPricesInput,
  ListPriceChangesInput,
  PriceChangePageDto,
  type KitPriceSort,
} from '@shakti/contracts';
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
import { parseQueryInput } from '../parse-input';

type PricingContext = Pick<RequestContext, 'tx' | 'principal'>;

/**
 * The columns Price Master › Kits sorts by (`KIT_PRICE_SORT_COLUMNS`). A kit not yet priced on
 * the list has no price or date, and comes last either way.
 */
const KIT_PRICE_SORT_KEYS: SortKeys<KitPriceSort['column']> = {
  kit: { expr: schema.kits.name, type: 'text', nullable: false },
  code: { expr: schema.kits.sku, type: 'text', nullable: false },
  price: { expr: schema.priceListItems.price, type: 'numeric', nullable: true },
  updated: { expr: schema.priceListItems.updatedAt, type: 'timestamptz', nullable: true },
};

/**
 * Price Master › Kits: the kits still sold with their price on one list, a page at a time, a kit
 * not yet priced with a null price. Selling prices only. The list must be readable to the caller.
 */
export async function listKitPrices(
  ctx: PricingContext,
  rawInput: unknown,
): Promise<KitPricePageDto> {
  const input = parseQueryInput(ListKitPricesInput, rawInput, 'pricing.kit_prices.list');
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
  const k = schema.kits;
  const pli = schema.priceListItems;
  const order = keysetOrder(KIT_PRICE_SORT_KEYS, k.id, input.sort, {
    column: 'kit',
    direction: 'asc',
  });
  const rows = await ctx.tx
    .select({
      kitId: k.id,
      sku: k.sku,
      name: k.name,
      price: pli.price,
      updatedAt: pli.updatedAt,
      sortValue: sortText(order),
    })
    .from(k)
    .leftJoin(pli, and(eq(pli.kitId, k.id), eq(pli.priceListId, input.priceListId)))
    .where(and(isNull(k.archivedAt), eq(k.isActive, true), afterCursor(order, input.cursor)))
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return KitPricePageDto.parse({
    items: page.map((r) => ({
      kitId: r.kitId,
      sku: r.sku,
      name: r.name,
      price: r.price,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    })),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.kitId },
    ),
  });
}

const CHANGE_ORDER_KEYS: SortKeys<'created'> = {
  created: { expr: schema.priceChangeLog.createdAt, type: 'timestamptz', nullable: false },
};

const changeOrder = () =>
  keysetOrder(CHANGE_ORDER_KEYS, schema.priceChangeLog.id, undefined, {
    column: 'created',
    direction: 'desc',
  });

/** The page read of `listPriceChanges`, one row more than the page; the spike explains it. */
export function priceChangesQuery(ctx: Pick<RequestContext, 'tx'>, input: ListPriceChangesInput) {
  const log = schema.priceChangeLog;
  const pli = schema.priceListItems;
  const pl = schema.priceLists;
  const t = schema.priceTiers;
  const p = schema.principals;
  const order = changeOrder();
  const target =
    input.itemId !== undefined ? eq(pli.itemId, input.itemId) : eq(pli.kitId, input.kitId ?? '');
  return ctx.tx
    .select({
      id: log.id,
      priceListId: pl.id,
      tierName: t.name,
      entityId: pl.entityId,
      version: pl.version,
      oldPrice: log.oldPrice,
      newPrice: log.newPrice,
      reason: log.reason,
      changedByName: p.displayName,
      createdAt: log.createdAt,
      sortValue: sortText(order),
    })
    .from(log)
    .innerJoin(pli, eq(pli.id, log.priceListItemId))
    .innerJoin(pl, eq(pl.id, pli.priceListId))
    .innerJoin(t, eq(t.id, pl.tierId))
    .leftJoin(p, eq(p.id, log.changedBy))
    .where(and(target, afterCursor(order, input.cursor)))
    .orderBy(...orderTerms(order))
    .limit((input.limit ?? 25) + 1);
}

/**
 * The change log of one item's or kit's price (`price_change_log`), newest first, on every list
 * the caller can read: the list, the old and new price, the reason and who changed it.
 */
export async function listPriceChanges(
  ctx: PricingContext,
  rawInput: unknown,
): Promise<PriceChangePageDto> {
  const input = parseQueryInput(ListPriceChangesInput, rawInput, 'pricing.changes.list');
  checkPermission(ctx.principal, 'pricing.read', 'entity');
  const rows = await priceChangesQuery(ctx, input);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return PriceChangePageDto.parse({
    items: page.map(({ sortValue: _sortValue, createdAt, ...r }) => ({
      ...r,
      createdAt: createdAt.toISOString(),
    })),
    nextCursor: nextCursor(
      changeOrder(),
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.id },
    ),
  });
}
