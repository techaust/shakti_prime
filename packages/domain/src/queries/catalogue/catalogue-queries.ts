import {
  GetItemInput,
  GetKitInput,
  ListKitsInput,
  KitPageDto,
  type ItemDetailDto,
  type KitDetailDto,
  type KitSort,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { parseQueryInput } from '../parse-input';
import { containsPattern } from '../search-text';
import { readItemDetail, readKitDetail } from './item-detail';

type CatalogueContext = Pick<RequestContext, 'tx'>;

/** The columns Catalogue › Kits sorts by (`KIT_SORT_COLUMNS`), none of them ever empty. */
const KIT_SORT_KEYS: SortKeys<KitSort['column']> = {
  name: { expr: schema.kits.name, type: 'text', nullable: false },
  sku: { expr: schema.kits.sku, type: 'text', nullable: false },
  updated: { expr: schema.kits.updatedAt, type: 'timestamptz', nullable: false },
};

/**
 * Catalogue › Kits: the kits every company sells, with how many items each holds, a page at a
 * time by name unless another order is asked for. Archived kits are left out unless asked for.
 */
export async function listKits(ctx: CatalogueContext, rawInput: unknown): Promise<KitPageDto> {
  const input = parseQueryInput(ListKitsInput, rawInput, 'catalogue.kits.list');
  const k = schema.kits;
  const order = keysetOrder(KIT_SORT_KEYS, k.id, input.sort, { column: 'name', direction: 'asc' });
  const pattern = input.q === undefined ? undefined : containsPattern(input.q);
  const rows = await ctx.tx
    .select({
      kit: k,
      // qualified by hand: drizzle writes a bare column name inside a raw fragment
      componentCount: sql<number>`(select count(*)::int from kit_components c where c.kit_id = kits.id)`,
      sortValue: sortText(order),
    })
    .from(k)
    .where(
      and(
        input.includeArchived ? undefined : isNull(k.archivedAt),
        pattern === undefined ? undefined : or(ilike(k.name, pattern), ilike(k.sku, pattern)),
        afterCursor(order, input.cursor),
      ),
    )
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return KitPageDto.parse({
    items: page.map(({ kit, componentCount }) => ({
      id: kit.id,
      sku: kit.sku,
      name: kit.name,
      isActive: kit.isActive && kit.archivedAt === null,
      componentCount,
      updatedAt: kit.updatedAt.toISOString(),
    })),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.kit.id },
    ),
  });
}

/** The item sheet: an item with its specifications and pump curve. */
export async function getItem(ctx: CatalogueContext, rawInput: unknown): Promise<ItemDetailDto> {
  const input = parseQueryInput(GetItemInput, rawInput, 'catalogue.item.get');
  return readItemDetail(ctx.tx, input.itemId);
}

/** The kit sheet: a kit with its components. */
export async function getKit(ctx: CatalogueContext, rawInput: unknown): Promise<KitDetailDto> {
  const input = parseQueryInput(GetKitInput, rawInput, 'catalogue.kit.get');
  return readKitDetail(ctx.tx, input.kitId);
}
